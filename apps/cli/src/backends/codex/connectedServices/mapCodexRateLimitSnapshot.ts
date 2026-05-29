import {
  ConnectedServiceQuotaSnapshotV1Schema,
  type ConnectedServiceId,
  type ConnectedServiceProfileId,
  type ConnectedServiceQuotaMeterV1,
  type ConnectedServiceQuotaSnapshotV1,
} from '@happier-dev/protocol';

import { unwrapCodexRateLimitSnapshot } from '../appServer/rateLimitSnapshot';
import { parseProviderTimestampMs } from '@/daemon/connectedServices/quotas/normalization';

export const CODEX_RATE_LIMIT_SNAPSHOT_STALE_AFTER_MS = 5 * 60 * 1000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (text.length === 0) return null;
  const numeric = Number(text);
  return Number.isFinite(numeric) ? numeric : null;
}

function readUtilizationPct(value: unknown): number | null {
  const numeric = readFiniteNumber(value);
  if (numeric === null) return null;
  return Math.max(0, Math.min(100, numeric));
}

function buildMeter(meterId: 'primary' | 'secondary', raw: unknown): ConnectedServiceQuotaMeterV1 | null {
  const record = isRecord(raw) ? raw : null;
  if (!record) return null;
  const utilizationPct = readUtilizationPct(record.usedPercent ?? record.used_percent ?? record.utilizationPct ?? record.utilization_pct);
  const used = readFiniteNumber(record.used ?? record.usedTokens ?? record.used_tokens);
  const limit = readFiniteNumber(record.limit ?? record.tokenLimit ?? record.token_limit);
  const resetsAt = parseProviderTimestampMs(record.resetsAt ?? record.resets_at ?? record.resetAt ?? record.reset_at);
  if (utilizationPct === null && used === null && limit === null && resetsAt === null) return null;
  const derivedRemainingPct = utilizationPct !== null
    ? Math.max(0, Math.min(100, 100 - utilizationPct))
    : used !== null && limit !== null && limit > 0
    ? Math.max(0, Math.min(100, ((limit - used) / limit) * 100))
    : null;
  const providerLimitId =
    readString(record.providerLimitId ?? record.provider_limit_id ?? record.limitId ?? record.limit_id)
    ?? meterId;
  return {
    meterId,
    label: meterId === 'primary' ? 'Primary' : 'Secondary',
    used,
    limit,
    remainingPct: derivedRemainingPct,
    resetAtMs: resetsAt,
    providerLimitId,
    unit: 'unknown',
    utilizationPct,
    resetsAt,
    status: 'ok',
    source: 'in_band_provider_snapshot',
    scope: meterId,
    limitScope: 'account',
    confidence: utilizationPct !== null || (used !== null && limit !== null) ? 'exact' : 'unknown',
    details: {},
  };
}

export function mapCodexRateLimitSnapshotToQuotaSnapshot(params: Readonly<{
  serviceId: ConnectedServiceId;
  profileId: ConnectedServiceProfileId;
  fetchedAt: number;
  staleAfterMs?: number;
  rawSnapshot: unknown;
}>): ConnectedServiceQuotaSnapshotV1 {
  const unwrappedSnapshot = unwrapCodexRateLimitSnapshot(params.rawSnapshot);
  const raw = isRecord(unwrappedSnapshot) ? unwrappedSnapshot : {};
  const account = isRecord(raw.account) ? raw.account : {};
  const meters = [
    buildMeter('primary', raw.primary ?? raw.primary_window ?? raw.primaryWindow),
    buildMeter('secondary', raw.secondary ?? raw.secondary_window ?? raw.secondaryWindow),
  ].filter((meter): meter is ConnectedServiceQuotaMeterV1 => meter !== null);

  return ConnectedServiceQuotaSnapshotV1Schema.parse({
    v: 1,
    serviceId: params.serviceId,
    profileId: params.profileId,
    fetchedAt: Math.max(0, Math.trunc(params.fetchedAt)),
    staleAfterMs: params.staleAfterMs ?? CODEX_RATE_LIMIT_SNAPSHOT_STALE_AFTER_MS,
    planLabel: readString(raw.planType ?? raw.plan_type),
    accountLabel: readString(account.email ?? raw.email ?? raw.accountLabel ?? raw.account_label),
    meters,
  });
}
