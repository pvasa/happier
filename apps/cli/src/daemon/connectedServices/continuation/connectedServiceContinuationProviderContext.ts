import { AGENT_IDS, resolveVendorResumeIdFromSessionMetadata, type AgentId } from '@happier-dev/agents';

import type { TrackedSession } from '@/daemon/types';
import { ConnectedServiceBindingsV1Schema } from '@happier-dev/protocol';
import { resolveConnectedServiceCandidatePersistedSessionFile } from '@/backends/catalog';
import { CATALOG_AGENT_IDS, type CatalogAgentId } from '@/backends/types';
import { readConnectedServiceMaterializationIdentityV1 } from '../materialize/createConnectedServiceMaterializationIdentity';
import { resolveConnectedServiceTargetMaterializedRoot } from '../materialize/resolveConnectedServiceTargetMaterializedRoot';
import { canResumeFromMaterializedState } from '../stateSharing/canResumeFromMaterializedState';

type ContinuationContextTrackedSession = Pick<
  TrackedSession,
  'happySessionId' | 'happySessionMetadataFromLocalWebhook' | 'spawnOptions' | 'vendorResumeId'
>;

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isAgentId(value: unknown): value is AgentId {
  return typeof value === 'string' && (AGENT_IDS as readonly string[]).includes(value);
}

function isCatalogAgentId(value: unknown): value is CatalogAgentId {
  return typeof value === 'string' && (CATALOG_AGENT_IDS as readonly string[]).includes(value);
}

function resolveTrackedCatalogAgentId(
  tracked: Pick<ContinuationContextTrackedSession, 'happySessionMetadataFromLocalWebhook' | 'spawnOptions'>,
): CatalogAgentId | null {
  const target = tracked.spawnOptions?.backendTarget;
  if (target?.kind === 'builtInAgent' && isCatalogAgentId(target.agentId)) return target.agentId;
  const flavor = tracked.happySessionMetadataFromLocalWebhook?.flavor;
  return isCatalogAgentId(flavor) ? flavor : null;
}

function hasConnectedServiceBinding(rawBindings: unknown): boolean {
  const parsed = ConnectedServiceBindingsV1Schema.safeParse(rawBindings);
  if (!parsed.success) return false;
  return Object.values(parsed.data.bindingsByServiceId).some((binding) => binding.source === 'connected');
}

function readConnectedServiceBindingServiceId(rawBindings: unknown): string | null {
  const parsed = ConnectedServiceBindingsV1Schema.safeParse(rawBindings);
  if (!parsed.success) return null;
  for (const [serviceId, binding] of Object.entries(parsed.data.bindingsByServiceId)) {
    if (binding.source === 'connected') return serviceId;
  }
  return null;
}

function resolveTrackedVendorResumeId(
  tracked: Pick<ContinuationContextTrackedSession, 'happySessionMetadataFromLocalWebhook' | 'spawnOptions' | 'vendorResumeId'>,
): string | null {
  const direct = normalizeOptionalString(tracked.vendorResumeId);
  if (direct) return direct;

  const fromSpawn = normalizeOptionalString(tracked.spawnOptions?.resume);
  if (fromSpawn) return fromSpawn;

  const agentId = resolveTrackedCatalogAgentId(tracked);
  if (!agentId) return null;
  return resolveVendorResumeIdFromSessionMetadata(agentId, tracked.happySessionMetadataFromLocalWebhook);
}

async function hasExactReachableResumeContext(input: Readonly<{
  tracked: Pick<ContinuationContextTrackedSession, 'happySessionMetadataFromLocalWebhook' | 'spawnOptions' | 'vendorResumeId'>;
  agentId: CatalogAgentId;
}>): Promise<boolean> {
  const tracked = input.tracked;
  const vendorResumeId = resolveTrackedVendorResumeId(tracked);
  if (!vendorResumeId) return false;

  const connectedServiceMaterializationIdentityV1 = readConnectedServiceMaterializationIdentityV1(
    tracked.spawnOptions?.connectedServiceMaterializationIdentityV1,
  );
  if (!connectedServiceMaterializationIdentityV1) return false;

  const serviceId = readConnectedServiceBindingServiceId(tracked.spawnOptions?.connectedServices);
  if (!serviceId) return false;

  const targetMaterializedEnv = tracked.spawnOptions?.environmentVariables ?? null;
  const targetMaterializedRoot = resolveConnectedServiceTargetMaterializedRoot({
    agentId: input.agentId,
    targetMaterializedEnv,
  });
  const cwd = normalizeOptionalString(tracked.spawnOptions?.directory);
  if (!targetMaterializedEnv || !targetMaterializedRoot || !cwd) return false;

  const reachability = await canResumeFromMaterializedState({
    agentId: input.agentId,
    serviceId,
    targetMaterializedRoot,
    targetMaterializedEnv,
    requestedStateMode: 'isolated',
    effectiveStateMode: 'isolated',
    materializationIdentity: connectedServiceMaterializationIdentityV1,
    vendorResumeId,
    cwd,
    candidatePersistedSessionFile: resolveConnectedServiceCandidatePersistedSessionFile(
      input.agentId,
      tracked.happySessionMetadataFromLocalWebhook ?? null,
    ),
  });
  return reachability.ok;
}

export async function resolveConnectedServiceContinuationProviderContextAvailability(input: Readonly<{
  tracked: Pick<ContinuationContextTrackedSession, 'happySessionMetadataFromLocalWebhook' | 'spawnOptions' | 'vendorResumeId'>;
}>): Promise<boolean> {
  if (!hasConnectedServiceBinding(input.tracked.spawnOptions?.connectedServices)) return true;
  if (!readConnectedServiceMaterializationIdentityV1(
    input.tracked.spawnOptions?.connectedServiceMaterializationIdentityV1,
  )) {
    return false;
  }

  const agentId = resolveTrackedCatalogAgentId(input.tracked);
  if (!agentId) return false;

  return await hasExactReachableResumeContext({
    tracked: input.tracked,
    agentId,
  });
}

export async function replayPendingConnectedServiceContinuationsForTrackedSessions(input: Readonly<{
  trackedSessions: Iterable<ContinuationContextTrackedSession>;
  resolvePendingContinuation: (input: Readonly<{
    sessionId: string;
    exactProviderContextAvailable: boolean;
  }>) => Promise<void> | void;
}>): Promise<Readonly<{ attemptedSessionIds: string[] }>> {
  const attemptedSessionIds: string[] = [];
  for (const tracked of input.trackedSessions) {
    const sessionId = normalizeOptionalString(tracked.happySessionId);
    if (!sessionId) continue;
    attemptedSessionIds.push(sessionId);
    await input.resolvePendingContinuation({
      sessionId,
      exactProviderContextAvailable: await resolveConnectedServiceContinuationProviderContextAvailability({ tracked }),
    });
  }
  return { attemptedSessionIds };
}
