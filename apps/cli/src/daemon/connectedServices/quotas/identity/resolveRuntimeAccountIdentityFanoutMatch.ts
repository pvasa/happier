import type { ConnectedServiceId } from '@happier-dev/protocol';

import type { ConnectedServiceSameAccountFanoutStrategy } from './providerFanoutStrategy';
import type {
  ReconciledRuntimeAccountIdentityEntry,
  RuntimeAccountIdentityEntry,
  RuntimeAccountIdentityProbeResult,
} from './runtimeAccountIdentityTypes';

export type RuntimeIdentityFanoutSuppressionReason =
  | 'runtime_identity_probe_missing_exact_identity'
  | 'runtime_identity_probe_account_mismatch';

function readNonEmptyString(value: string | null | undefined): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed ? trimmed : null;
}

function readGeneration(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.trunc(value)
    : null;
}

export function resolveRuntimeAccountIdentityFanoutMatch(input: Readonly<{
  strategy: ConnectedServiceSameAccountFanoutStrategy;
  serviceId: ConnectedServiceId;
  groupId: string;
  providerAccountId: string;
  candidate: Pick<
    RuntimeAccountIdentityEntry,
    'sessionId' | 'serviceId' | 'groupId' | 'profileId' | 'accountLabel' | 'groupGeneration'
  >;
  result: RuntimeAccountIdentityProbeResult;
  observedAtMs: number;
}>):
  | Readonly<{
      status: 'matched';
      entry: ReconciledRuntimeAccountIdentityEntry;
      staleExpectedStateReconciled: boolean;
    }>
  | Readonly<{
      status: 'suppressed';
      reason: RuntimeIdentityFanoutSuppressionReason;
    }> {
  if (input.result.status !== 'verified' || input.result.proofStrength !== 'exact') {
    return { status: 'suppressed', reason: 'runtime_identity_probe_missing_exact_identity' };
  }

  const strategy = input.result.strategy ?? 'provider_account_id';
  const providerAccountId = readNonEmptyString(input.result.providerAccountId);
  const sharedAuthSurfaceId = readNonEmptyString(input.result.sharedAuthSurfaceId) ?? readNonEmptyString(input.result.groupId);
  if (input.strategy === 'provider_account_id') {
    if (strategy !== 'provider_account_id' || !providerAccountId) {
      return { status: 'suppressed', reason: 'runtime_identity_probe_missing_exact_identity' };
    }
    if (providerAccountId !== input.providerAccountId) {
      return { status: 'suppressed', reason: 'runtime_identity_probe_account_mismatch' };
    }
  } else if (input.strategy === 'shared_group_auth_surface') {
    if (strategy !== 'shared_group_auth_surface' || sharedAuthSurfaceId !== input.groupId) {
      return { status: 'suppressed', reason: 'runtime_identity_probe_account_mismatch' };
    }
  } else {
    return { status: 'suppressed', reason: 'runtime_identity_probe_missing_exact_identity' };
  }

  const runtimeGroupId = readNonEmptyString(input.result.groupId);
  if (runtimeGroupId && runtimeGroupId !== input.groupId) {
    return { status: 'suppressed', reason: 'runtime_identity_probe_account_mismatch' };
  }

  const runtimeProfileId = readNonEmptyString(input.result.profileId);
  const runtimeGroupGeneration = readGeneration(input.result.groupGeneration);
  const nextProfileId = runtimeProfileId ?? input.candidate.profileId;
  const nextGroupId = runtimeGroupId ?? input.candidate.groupId ?? input.groupId;
  const nextGroupGeneration = runtimeGroupGeneration ?? input.candidate.groupGeneration;
  const staleExpectedStateReconciled = (
    nextProfileId !== input.candidate.profileId
    || nextGroupId !== (input.candidate.groupId ?? input.groupId)
    || nextGroupGeneration !== input.candidate.groupGeneration
  );

  return {
    status: 'matched',
    staleExpectedStateReconciled,
    entry: {
      sessionId: input.candidate.sessionId,
      serviceId: input.serviceId,
      groupId: nextGroupId,
      profileId: nextProfileId,
      providerAccountId: providerAccountId ?? '',
      accountLabel: readNonEmptyString(input.result.accountLabel) ?? input.candidate.accountLabel,
      observedAtMs: input.observedAtMs,
      source: input.result.source ?? 'runtime_identity_probe',
      proofStrength: 'exact',
      groupGeneration: nextGroupGeneration,
      ...(input.result.runtime ? { runtime: input.result.runtime } : {}),
    },
  };
}
