import type { ConnectedServiceId, ConnectedServiceQuotaMeterV1, ConnectedServiceQuotaSnapshotV1 } from '@happier-dev/protocol';
import { readConnectedServiceLimitCategoryV1 } from '@happier-dev/protocol';

import { normalizeQuotaMeter, selectEffectiveQuotaMeter } from '../normalization';
import type { ProviderOutcomeProofKind } from '../../recovery/providerOutcomeProof';

export type QuotaProbeFreshNoProofReason =
  | 'service_mismatch'
  | 'profile_mismatch'
  | 'group_generation_mismatch'
  | 'material_fingerprint_mismatch'
  | 'stale_snapshot'
  | 'snapshot_unavailable'
  | 'snapshot_exhausted'
  | 'no_reliable_quota_meter';

export type QuotaProbeFreshProofResult =
  | Readonly<{ status: 'proof'; proofKind: Extract<ProviderOutcomeProofKind, 'quota_probe_fresh'> }>
  | Readonly<{ status: 'no_proof'; reason: QuotaProbeFreshNoProofReason }>;

function normalizeFingerprint(value: string | null | undefined): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed ? trimmed : null;
}

function normalizeGeneration(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.trunc(value)
    : null;
}

function isUnavailableMeter(meter: ConnectedServiceQuotaMeterV1): boolean {
  return meter.status === 'unavailable'
    || meter.confidence === 'unknown'
    || meter.confidence === 'stale';
}

function normalizeMeter(meter: ConnectedServiceQuotaMeterV1) {
  return normalizeQuotaMeter({
    meterId: meter.meterId,
    label: meter.label,
    limitCategory: readConnectedServiceLimitCategoryV1(
      typeof meter.details === 'object' && meter.details !== null && !Array.isArray(meter.details)
        ? (meter.details as Readonly<Record<string, unknown>>).limitCategory
        : undefined,
    ) ?? 'usage_limit',
    remainingPct: meter.remainingPct,
    utilizationPct: meter.utilizationPct,
    used: meter.used,
    limit: meter.limit,
    resetAtMs: meter.resetAtMs ?? meter.resetsAt,
    providerLimitId: meter.providerLimitId,
    reliable: !isUnavailableMeter(meter),
    applicable: meter.status !== 'unavailable',
  });
}

export function resolveQuotaProbeFreshProof(input: Readonly<{
  nowMs: number;
  maxAgeMs: number;
  serviceId: ConnectedServiceId;
  profileId: string;
  groupId: string | null;
  expectedGroupGeneration: number | null;
  currentGroupGeneration: number | null;
  expectedMaterialFingerprint: string | null;
  snapshotMaterialFingerprint: string | null;
  snapshot: ConnectedServiceQuotaSnapshotV1;
}>): QuotaProbeFreshProofResult {
  if (input.snapshot.serviceId !== input.serviceId) {
    return { status: 'no_proof', reason: 'service_mismatch' };
  }
  if (input.snapshot.profileId !== input.profileId) {
    return { status: 'no_proof', reason: 'profile_mismatch' };
  }
  const expectedGeneration = normalizeGeneration(input.expectedGroupGeneration);
  const currentGeneration = normalizeGeneration(input.currentGroupGeneration);
  if (expectedGeneration !== null && currentGeneration !== expectedGeneration) {
    return { status: 'no_proof', reason: 'group_generation_mismatch' };
  }
  const expectedFingerprint = normalizeFingerprint(input.expectedMaterialFingerprint);
  const snapshotFingerprint = normalizeFingerprint(input.snapshotMaterialFingerprint);
  if (expectedFingerprint !== null && snapshotFingerprint !== expectedFingerprint) {
    return { status: 'no_proof', reason: 'material_fingerprint_mismatch' };
  }
  const fetchedAt = Number.isFinite(input.snapshot.fetchedAt) ? Math.trunc(input.snapshot.fetchedAt) : 0;
  const maxAgeMs = Math.max(1, Math.trunc(input.maxAgeMs));
  if (Math.max(0, Math.trunc(input.nowMs)) - fetchedAt > maxAgeMs) {
    return { status: 'no_proof', reason: 'stale_snapshot' };
  }
  if (input.snapshot.meters.length > 0 && input.snapshot.meters.every(isUnavailableMeter)) {
    return { status: 'no_proof', reason: 'snapshot_unavailable' };
  }
  const effective = selectEffectiveQuotaMeter(input.snapshot.meters.map(normalizeMeter));
  if (!effective) return { status: 'no_proof', reason: 'no_reliable_quota_meter' };
  if (effective.remainingPct !== null && effective.remainingPct <= 0) {
    return { status: 'no_proof', reason: 'snapshot_exhausted' };
  }
  return { status: 'proof', proofKind: 'quota_probe_fresh' };
}
