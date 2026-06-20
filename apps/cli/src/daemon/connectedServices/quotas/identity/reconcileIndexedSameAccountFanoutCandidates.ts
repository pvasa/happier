import type { ConnectedServiceId } from '@happier-dev/protocol';

import type {
  RuntimeAccountIdentityEntry,
  RuntimeAccountIdentityProbeResult,
  RuntimeAccountIdentityRecordInput,
  RuntimeAccountIdentityRecordResult,
} from './runtimeAccountIdentityTypes';

export type RuntimeAccountIdentityReader = (input: Readonly<{
  sessionId: string;
  serviceId: ConnectedServiceId;
  groupId: string;
  profileId: string;
  expectedGroupGeneration: number | null;
}>) => Promise<RuntimeAccountIdentityProbeResult>;

export type ReconciledRuntimeAccountIdentityEntry = RuntimeAccountIdentityEntry & Readonly<{
  runtime?: Readonly<{
    safeToApply?: boolean;
    inProviderTurn?: boolean;
  }>;
}>;

type SameAccountFanoutDiagnostic = Readonly<{
  event: 'quota_work_deferred' | 'quota_work_suppressed';
  phase: 'same_account_fanout';
  reason: string;
  retryAfterMs?: number;
}>;

function recordSuppression(
  recordDiagnostic: ((event: SameAccountFanoutDiagnostic) => void) | undefined,
  reason: string,
): void {
  recordDiagnostic?.({
    event: 'quota_work_suppressed',
    phase: 'same_account_fanout',
    reason,
  });
}

function readNonEmptyString(value: string | null | undefined): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed ? trimmed : null;
}

function readGeneration(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.trunc(value)
    : null;
}

export async function reconcileIndexedSameAccountFanoutCandidates(input: Readonly<{
  serviceId: ConnectedServiceId;
  groupId: string;
  providerAccountId: string;
  indexedCandidates: ReadonlyArray<RuntimeAccountIdentityEntry>;
  readRuntimeAccountIdentity?: RuntimeAccountIdentityReader | null;
  now: () => number;
  recordRuntimeAccountIdentity: (entry: RuntimeAccountIdentityRecordInput) => RuntimeAccountIdentityRecordResult;
  invalidateRuntimeAccountIdentity: (sessionId: string) => void;
  recordDiagnostic?: (event: SameAccountFanoutDiagnostic) => void;
}>): Promise<Array<RuntimeAccountIdentityEntry | ReconciledRuntimeAccountIdentityEntry>> {
  if (!input.readRuntimeAccountIdentity || input.indexedCandidates.length === 0) {
    return [...input.indexedCandidates];
  }

  const reconciled: Array<RuntimeAccountIdentityEntry | ReconciledRuntimeAccountIdentityEntry> = [];
  for (const candidate of input.indexedCandidates) {
    let result: RuntimeAccountIdentityProbeResult;
    try {
      result = await input.readRuntimeAccountIdentity({
        sessionId: candidate.sessionId,
        serviceId: candidate.serviceId,
        groupId: candidate.groupId ?? input.groupId,
        profileId: candidate.profileId,
        expectedGroupGeneration: candidate.groupGeneration,
      });
    } catch {
      recordSuppression(input.recordDiagnostic, 'runtime_identity_probe_missing_exact_identity');
      input.invalidateRuntimeAccountIdentity(candidate.sessionId);
      continue;
    }

    const strategy = result.status === 'verified' ? result.strategy ?? 'provider_account_id' : null;
    const providerAccountId = result.status === 'verified' ? readNonEmptyString(result.providerAccountId) : null;
    if (
      result.status !== 'verified'
      || result.proofStrength !== 'exact'
      || strategy !== 'provider_account_id'
      || !providerAccountId
    ) {
      recordSuppression(input.recordDiagnostic, 'runtime_identity_probe_missing_exact_identity');
      input.invalidateRuntimeAccountIdentity(candidate.sessionId);
      continue;
    }
    if (providerAccountId !== input.providerAccountId) {
      recordSuppression(input.recordDiagnostic, 'runtime_identity_probe_account_mismatch');
      input.invalidateRuntimeAccountIdentity(candidate.sessionId);
      continue;
    }

    const runtimeProfileId = readNonEmptyString(result.profileId);
    const runtimeGroupId = readNonEmptyString(result.groupId);
    const runtimeGroupGeneration = readGeneration(result.groupGeneration);
    if (runtimeGroupId && runtimeGroupId !== input.groupId) {
      recordSuppression(input.recordDiagnostic, 'runtime_identity_probe_account_mismatch');
      input.invalidateRuntimeAccountIdentity(candidate.sessionId);
      continue;
    }
    const nextProfileId = runtimeProfileId ?? candidate.profileId;
    const nextGroupId = runtimeGroupId ?? candidate.groupId ?? input.groupId;
    const nextGroupGeneration = runtimeGroupGeneration ?? candidate.groupGeneration;
    if (
      nextProfileId !== candidate.profileId
      || nextGroupId !== (candidate.groupId ?? input.groupId)
      || nextGroupGeneration !== candidate.groupGeneration
    ) {
      recordSuppression(input.recordDiagnostic, 'runtime_identity_probe_stale_expected_state_reconciled');
    }

    const entry: ReconciledRuntimeAccountIdentityEntry = {
      ...candidate,
      groupId: nextGroupId,
      profileId: nextProfileId,
      providerAccountId,
      accountLabel: typeof result.accountLabel === 'string' && result.accountLabel.trim()
        ? result.accountLabel.trim()
        : candidate.accountLabel,
      observedAtMs: input.now(),
      source: result.source ?? 'runtime_identity_probe',
      groupGeneration: nextGroupGeneration,
      ...(result.runtime ? { runtime: result.runtime } : {}),
    };
    input.recordRuntimeAccountIdentity(entry);
    reconciled.push(entry);
  }
  return reconciled;
}
