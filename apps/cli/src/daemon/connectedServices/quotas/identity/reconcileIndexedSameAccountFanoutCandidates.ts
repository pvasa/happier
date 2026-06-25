import type { ConnectedServiceId } from '@happier-dev/protocol';

import { resolveRuntimeAccountIdentityFanoutMatch } from './resolveRuntimeAccountIdentityFanoutMatch';
import type {
  ReconciledRuntimeAccountIdentityEntry,
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

    const match = resolveRuntimeAccountIdentityFanoutMatch({
      strategy: 'provider_account_id',
      serviceId: input.serviceId,
      groupId: input.groupId,
      providerAccountId: input.providerAccountId,
      candidate,
      result,
      observedAtMs: input.now(),
    });
    if (match.status === 'suppressed') {
      recordSuppression(input.recordDiagnostic, match.reason);
      input.invalidateRuntimeAccountIdentity(candidate.sessionId);
      continue;
    }
    if (match.staleExpectedStateReconciled) {
      recordSuppression(input.recordDiagnostic, 'runtime_identity_probe_stale_expected_state_reconciled');
    }
    input.recordRuntimeAccountIdentity(match.entry);
    reconciled.push(match.entry);
  }
  return reconciled;
}
