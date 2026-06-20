import { AGENT_IDS, type AgentId } from '@happier-dev/agents';

import type { TrackedSession } from '@/daemon/types';
import { ConnectedServiceBindingsV1Schema } from '@happier-dev/protocol';
import { join } from 'node:path';
import { CATALOG_AGENT_IDS, type CatalogAgentId } from '@/backends/types';
import { resolveConnectedServiceCandidatePersistedSessionFile } from '@/backends/catalog';
import { configuration } from '@/configuration';
import { resolveTrackedConnectedServiceSwitchContinuityContext } from '../sessionAuthSwitch/resolveTrackedConnectedServiceSwitchContinuityContext';
import { canResumeFromMaterializedState } from '../stateSharing/canResumeFromMaterializedState';
import { resolveTrackedConnectedServiceBindingsRaw } from '../trackedSessionConnectedServiceBindings';

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

function readRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : null;
}

function resolveTrackedCatalogAgentId(
  tracked: Pick<ContinuationContextTrackedSession, 'happySessionMetadataFromLocalWebhook' | 'spawnOptions'>,
  persistedSessionMetadata?: unknown,
): CatalogAgentId | null {
  const target = tracked.spawnOptions?.backendTarget;
  if (target?.kind === 'builtInAgent' && isCatalogAgentId(target.agentId)) return target.agentId;
  const flavor = tracked.happySessionMetadataFromLocalWebhook?.flavor;
  if (isCatalogAgentId(flavor)) return flavor;
  const persistedFlavor = readRecord(persistedSessionMetadata)?.flavor;
  return isCatalogAgentId(persistedFlavor) ? persistedFlavor : null;
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

function readPersistedConnectedServiceBindingsRaw(persistedSessionMetadata: unknown): unknown {
  return readRecord(persistedSessionMetadata)?.connectedServices;
}

function resolveContinuationConnectedServiceBindingsRaw(input: Readonly<{
  tracked: Pick<ContinuationContextTrackedSession, 'happySessionMetadataFromLocalWebhook' | 'spawnOptions'>;
  persistedSessionMetadata?: unknown;
}>): unknown {
  return resolveTrackedConnectedServiceBindingsRaw(input.tracked)
    ?? readPersistedConnectedServiceBindingsRaw(input.persistedSessionMetadata);
}

async function hasExactReachableResumeContext(input: Readonly<{
  tracked: Pick<ContinuationContextTrackedSession, 'happySessionMetadataFromLocalWebhook' | 'spawnOptions' | 'vendorResumeId'>;
  agentId: CatalogAgentId;
  persistedSessionMetadata?: unknown;
}>): Promise<boolean> {
  const tracked = input.tracked;
  const continuityContext = resolveTrackedConnectedServiceSwitchContinuityContext({
    agentId: input.agentId,
    baseDir: join(configuration.happyHomeDir, 'daemon', 'connected-services', 'materialized'),
    tracked,
    persistedSessionMetadata: input.persistedSessionMetadata,
    resolveCandidatePersistedSessionFile: resolveConnectedServiceCandidatePersistedSessionFile,
  });
  if (!continuityContext.vendorResumeId) return false;
  if (!continuityContext.connectedServiceMaterializationIdentityV1) return false;

  const serviceId = readConnectedServiceBindingServiceId(resolveContinuationConnectedServiceBindingsRaw({
    tracked,
    persistedSessionMetadata: input.persistedSessionMetadata,
  }));
  if (!serviceId) return false;
  if (!continuityContext.targetMaterializedEnv || !continuityContext.targetMaterializedRoot || !continuityContext.cwd) {
    return false;
  }

  const reachability = await canResumeFromMaterializedState({
    agentId: input.agentId,
    serviceId,
    targetMaterializedRoot: continuityContext.targetMaterializedRoot,
    targetMaterializedEnv: continuityContext.targetMaterializedEnv,
    requestedStateMode: 'isolated',
    effectiveStateMode: 'isolated',
    materializationIdentity: continuityContext.connectedServiceMaterializationIdentityV1,
    vendorResumeId: continuityContext.vendorResumeId,
    cwd: continuityContext.cwd,
    candidatePersistedSessionFile: continuityContext.candidatePersistedSessionFile,
  });
  return reachability.ok;
}

export async function resolveConnectedServiceContinuationProviderContextAvailability(input: Readonly<{
  tracked: Pick<ContinuationContextTrackedSession, 'happySessionMetadataFromLocalWebhook' | 'spawnOptions' | 'vendorResumeId'>;
  persistedSessionMetadata?: unknown;
}>): Promise<boolean> {
  const connectedServicesRaw = resolveContinuationConnectedServiceBindingsRaw({
    tracked: input.tracked,
    persistedSessionMetadata: input.persistedSessionMetadata,
  });
  if (!hasConnectedServiceBinding(connectedServicesRaw)) return true;

  const agentId = resolveTrackedCatalogAgentId(input.tracked, input.persistedSessionMetadata);
  if (!agentId) return false;

  return await hasExactReachableResumeContext({
    tracked: input.tracked,
    agentId,
    persistedSessionMetadata: input.persistedSessionMetadata,
  });
}

export async function replayPendingConnectedServiceContinuationsForTrackedSessions(input: Readonly<{
  trackedSessions: Iterable<ContinuationContextTrackedSession>;
  resolvePersistedSessionMetadata?: (input: Readonly<{
    sessionId: string;
    tracked: ContinuationContextTrackedSession;
  }>) => Promise<unknown> | unknown;
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
    const persistedSessionMetadata = input.resolvePersistedSessionMetadata
      ? await input.resolvePersistedSessionMetadata({ sessionId, tracked })
      : undefined;
    await input.resolvePendingContinuation({
      sessionId,
      exactProviderContextAvailable: await resolveConnectedServiceContinuationProviderContextAvailability({
        tracked,
        persistedSessionMetadata,
      }),
    });
  }
  return { attemptedSessionIds };
}
