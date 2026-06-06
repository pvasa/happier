import { isAbsolute } from 'node:path';

import { resolveVendorResumeIdFromSessionMetadata } from '@happier-dev/agents';
import {
  readConnectedServiceMaterializationIdentityV1FromMetadata,
  type ConnectedServiceMaterializationIdentityV1,
} from '@happier-dev/protocol';

import {
  resolveConnectedServiceCandidatePersistedSessionFile,
} from '@/backends/catalog';
import type { CatalogAgentId } from '@/backends/types';
import type { TrackedSession } from '@/daemon/types';
import {
  readConnectedServiceMaterializationIdentityV1,
} from '@/daemon/connectedServices/materialize/createConnectedServiceMaterializationIdentity';
import {
  resolveConnectedServiceSwitchTargetMaterializedContext,
} from '@/daemon/connectedServices/materialize/resolveConnectedServiceSwitchTargetMaterializedContext';

type ContinuityTrackedSession = Pick<
  TrackedSession,
  'happySessionMetadataFromLocalWebhook' | 'spawnOptions' | 'vendorResumeId'
>;

type ResolvedTrackedResumeContext = Readonly<{
  vendorResumeId: string | null;
  candidatePersistedSessionFile: string | null;
}>;

export function resolveTrackedConnectedServiceMaterializationIdentity(input: Readonly<{
  tracked: ContinuityTrackedSession | null;
  connectedServiceMaterializationIdentityV1?: ConnectedServiceMaterializationIdentityV1 | null;
}>): ConnectedServiceMaterializationIdentityV1 | null {
  return readConnectedServiceMaterializationIdentityV1(
    input.tracked?.spawnOptions?.connectedServiceMaterializationIdentityV1,
  ) ?? input.connectedServiceMaterializationIdentityV1
    ?? readConnectedServiceMaterializationIdentityV1FromMetadata(
      input.tracked?.happySessionMetadataFromLocalWebhook ?? null,
    );
}

export function resolveTrackedConnectedServiceVendorResumeId(input: Readonly<{
  agentId: CatalogAgentId;
  tracked: ContinuityTrackedSession | null;
  vendorResumeId?: string | null;
}>): string | null {
  return normalizeOptionalString(input.tracked?.vendorResumeId)
    ?? normalizeOptionalString(input.tracked?.spawnOptions?.resume)
    ?? resolveVendorResumeIdFromSessionMetadata(
      input.agentId,
      input.tracked?.happySessionMetadataFromLocalWebhook ?? null,
    )
    ?? normalizeOptionalString(input.vendorResumeId);
}

function normalizeOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function normalizeOptionalAbsolutePath(value: unknown): string | null {
  const normalized = normalizeOptionalString(value);
  return normalized && isAbsolute(normalized) ? normalized : null;
}

function resolveTrackedConnectedServiceResumeContext(input: Readonly<{
  agentId: CatalogAgentId;
  tracked: ContinuityTrackedSession | null;
  vendorResumeId?: string | null;
  candidatePersistedSessionFile?: string | null;
}>): ResolvedTrackedResumeContext {
  const metadata = input.tracked?.happySessionMetadataFromLocalWebhook ?? null;
  const metadataVendorResumeId = resolveVendorResumeIdFromSessionMetadata(input.agentId, metadata);
  const metadataCandidatePersistedSessionFile = metadata
    ? resolveConnectedServiceCandidatePersistedSessionFile(input.agentId, metadata)
    : null;
  const trackedVendorResumeId = normalizeOptionalString(input.tracked?.vendorResumeId);
  const trackedSpawnResume = normalizeOptionalString(input.tracked?.spawnOptions?.resume);
  const trackedSpawnResumeCandidate = normalizeOptionalAbsolutePath(trackedSpawnResume);
  const explicitVendorResumeId = normalizeOptionalString(input.vendorResumeId);
  const explicitCandidatePersistedSessionFile = normalizeOptionalString(input.candidatePersistedSessionFile);

  if (trackedVendorResumeId) {
    return {
      vendorResumeId: trackedVendorResumeId,
      candidatePersistedSessionFile: trackedSpawnResumeCandidate
        ?? (metadataVendorResumeId === trackedVendorResumeId ? metadataCandidatePersistedSessionFile : null)
        ?? (explicitVendorResumeId === trackedVendorResumeId ? explicitCandidatePersistedSessionFile : null),
    };
  }

  if (trackedSpawnResume) {
    return {
      vendorResumeId: trackedSpawnResume,
      candidatePersistedSessionFile: trackedSpawnResumeCandidate
        ?? (metadataVendorResumeId === trackedSpawnResume ? metadataCandidatePersistedSessionFile : null)
        ?? (explicitVendorResumeId === trackedSpawnResume ? explicitCandidatePersistedSessionFile : null),
    };
  }

  if (metadataVendorResumeId) {
    return {
      vendorResumeId: metadataVendorResumeId,
      candidatePersistedSessionFile: metadataCandidatePersistedSessionFile,
    };
  }

  return {
    vendorResumeId: explicitVendorResumeId,
    candidatePersistedSessionFile: explicitCandidatePersistedSessionFile,
  };
}

export function resolveTrackedConnectedServiceSwitchContinuityContext(input: Readonly<{
  agentId: CatalogAgentId;
  baseDir: string;
  tracked: ContinuityTrackedSession | null;
  connectedServiceMaterializationIdentityV1?: ConnectedServiceMaterializationIdentityV1 | null;
  vendorResumeId?: string | null;
  cwd?: string | null;
  candidatePersistedSessionFile?: string | null;
}>): Readonly<{
  connectedServiceMaterializationIdentityV1: ConnectedServiceMaterializationIdentityV1 | null;
  targetMaterializedRoot: string | null;
  targetMaterializedEnv: Readonly<Record<string, string>> | null;
  vendorResumeId: string | null;
  cwd: string | null;
  candidatePersistedSessionFile: string | null;
}> {
  const resumeContext = resolveTrackedConnectedServiceResumeContext({
    agentId: input.agentId,
    tracked: input.tracked,
    vendorResumeId: input.vendorResumeId,
    candidatePersistedSessionFile: input.candidatePersistedSessionFile,
  });
  const effectiveIdentity = resolveTrackedConnectedServiceMaterializationIdentity({
    tracked: input.tracked,
    connectedServiceMaterializationIdentityV1: input.connectedServiceMaterializationIdentityV1,
  });
  const { targetMaterializedEnv, targetMaterializedRoot } =
    resolveConnectedServiceSwitchTargetMaterializedContext({
      agentId: input.agentId,
      baseDir: input.baseDir,
      inheritedEnv: input.tracked?.spawnOptions?.environmentVariables ?? null,
      effectiveIdentity,
    });
  return {
    connectedServiceMaterializationIdentityV1: effectiveIdentity,
    targetMaterializedRoot,
    targetMaterializedEnv,
    vendorResumeId: resumeContext.vendorResumeId,
    cwd: normalizeOptionalString(input.tracked?.spawnOptions?.directory)
      ?? normalizeOptionalString(input.cwd),
    candidatePersistedSessionFile: resumeContext.candidatePersistedSessionFile,
  };
}
