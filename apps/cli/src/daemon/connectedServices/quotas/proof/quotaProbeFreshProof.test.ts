import { describe, expect, it } from 'vitest';

import type { ConnectedServiceQuotaSnapshotV1 } from '@happier-dev/protocol';

import { resolveQuotaProbeFreshProof } from './quotaProbeFreshProof';

function quotaSnapshot(overrides: Partial<ConnectedServiceQuotaSnapshotV1> = {}): ConnectedServiceQuotaSnapshotV1 {
  return {
    v: 1 as const,
    serviceId: 'openai-codex' as const,
    profileId: 'backup',
    fetchedAt: 10_000,
    staleAfterMs: 60_000,
    planLabel: null,
    accountLabel: null,
    meters: [{
      meterId: 'weekly',
      label: 'Weekly',
      used: 10,
      limit: 100,
      unit: 'requests' as const,
      utilizationPct: 10,
      remainingPct: 90,
      resetsAt: 100_000,
      status: 'ok' as const,
      details: {},
    }],
    ...overrides,
  };
}

describe('resolveQuotaProbeFreshProof', () => {
  it('produces quota_probe_fresh only for fresh matching usable normalized quota evidence', () => {
    expect(resolveQuotaProbeFreshProof({
      nowMs: 12_000,
      maxAgeMs: 30_000,
      serviceId: 'openai-codex',
      profileId: 'backup',
      groupId: 'team',
      expectedGroupGeneration: 3,
      currentGroupGeneration: 3,
      expectedMaterialFingerprint: 'fingerprint-a',
      snapshotMaterialFingerprint: 'fingerprint-a',
      snapshot: quotaSnapshot(),
    })).toEqual({
      status: 'proof',
      proofKind: 'quota_probe_fresh',
    });
  });

  it('refuses stale, exhausted, disabled, mismatched, and generation-stale snapshots', () => {
    const base = {
      nowMs: 12_000,
      maxAgeMs: 1_000,
      serviceId: 'openai-codex' as const,
      profileId: 'backup',
      groupId: 'team',
      expectedGroupGeneration: 3,
      currentGroupGeneration: 3,
      expectedMaterialFingerprint: 'fingerprint-a',
      snapshotMaterialFingerprint: 'fingerprint-a',
      snapshot: quotaSnapshot(),
    };

    expect(resolveQuotaProbeFreshProof(base)).toEqual({ status: 'no_proof', reason: 'stale_snapshot' });
    expect(resolveQuotaProbeFreshProof({
      ...base,
      nowMs: 12_000,
      maxAgeMs: 30_000,
      snapshot: quotaSnapshot({
        meters: [{
          meterId: 'weekly',
          label: 'Weekly',
          used: 100,
          limit: 100,
          unit: 'requests' as const,
          utilizationPct: 100,
          remainingPct: 0,
          resetsAt: 100_000,
          status: 'ok' as const,
          details: {},
        }],
      }),
    })).toEqual({ status: 'no_proof', reason: 'snapshot_exhausted' });
    expect(resolveQuotaProbeFreshProof({
      ...base,
      nowMs: 12_000,
      maxAgeMs: 30_000,
      snapshot: quotaSnapshot({
        meters: [{
          meterId: 'weekly',
          label: 'Weekly',
          used: null,
          limit: null,
          unit: 'unknown' as const,
          utilizationPct: null,
          remainingPct: null,
          resetsAt: null,
          status: 'unavailable' as const,
          confidence: 'unknown' as const,
          details: { code: 'quota_fetch_disabled' },
        }],
      }),
    })).toEqual({ status: 'no_proof', reason: 'snapshot_unavailable' });
    expect(resolveQuotaProbeFreshProof({
      ...base,
      nowMs: 12_000,
      maxAgeMs: 30_000,
      profileId: 'other',
    })).toEqual({ status: 'no_proof', reason: 'profile_mismatch' });
    expect(resolveQuotaProbeFreshProof({
      ...base,
      nowMs: 12_000,
      maxAgeMs: 30_000,
      currentGroupGeneration: 4,
    })).toEqual({ status: 'no_proof', reason: 'group_generation_mismatch' });
    expect(resolveQuotaProbeFreshProof({
      ...base,
      nowMs: 12_000,
      maxAgeMs: 30_000,
      snapshotMaterialFingerprint: 'fingerprint-b',
    })).toEqual({ status: 'no_proof', reason: 'material_fingerprint_mismatch' });
  });
});
