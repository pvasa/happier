import type { ConnectedServiceId, ConnectedServiceProfileId } from '@happier-dev/protocol';

import { classifyPrimarySessionRuntimeIssue } from '@/agent/runtime/session/errors/classifyPrimarySessionRuntimeIssue';

export type CodexConnectedServiceRuntimeFailureKind =
  | 'usage_limit'
  | 'rate_limit'
  | 'auth_expired'
  | 'account_changed'
  | 'refresh_failed'
  | 'permission_denied'
  | 'unknown';

export type CodexConnectedServiceRuntimeFailureClassification = Readonly<{
  kind: CodexConnectedServiceRuntimeFailureKind;
  limitCategory?: 'quota' | 'rate_limit' | 'capacity' | 'auth' | 'plan' | 'validation' | 'account_disabled' | 'unknown';
  serviceId: ConnectedServiceId;
  profileId: ConnectedServiceProfileId | null;
  groupId: string | null;
  resetsAtMs: number | null;
  retryAfterMs: number | null;
  planType: string | null;
  rateLimits: unknown | null;
  source: 'structured_provider_error' | 'stable_provider_message' | 'provider_runtime_marker';
  recoveryAction?: CodexConnectedServiceRecoveryAction | null;
}>;

export type CodexConnectedServiceRecoveryAction =
  | Readonly<{ kind: 'provider_state_sharing_required' }>
  | Readonly<{ kind: 'quota_recovery_required' }>;

export type ClassifyCodexConnectedServiceAuthFailureInput = Readonly<{
  providerErrorPath: boolean;
  error: unknown;
  serviceId: ConnectedServiceId;
  profileId: ConnectedServiceProfileId | null;
  groupId: string | null;
  nowMs?: number | null;
}>;

const CODEX_ACCOUNT_CHANGED_MESSAGE =
  'Your access token could not be refreshed because you have since logged out or signed in to another account. Please sign in again.';

const authExpiredProviderCodes = new Set([
  'token_invalidated',
  'token_revoked',
]);

const refreshFailedProviderCodes = new Set([
  'refresh_token_invalidated',
  'refresh_token_reused',
  'refresh_token_revoked',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readErrorRecord(value: unknown): Record<string, unknown> | null {
  const root = isRecord(value) ? value : null;
  const direct = isRecord(root?.error) ? root.error : null;
  const turn = isRecord(root?.turn) ? root.turn : null;
  const turnError = isRecord(turn?.error) ? turn.error : null;
  return direct ?? turnError ?? root;
}

function readErrorText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.message;
  const record = readErrorRecord(value);
  if (!record) return '';
  return [record.message, record.additionalDetails, record.additional_details, record.error, record.code, record.codexErrorInfo, record.codex_error_info]
    .filter((part): part is string => typeof part === 'string')
    .join(' ');
}

function isStructuredUsageLimitCode(value: string | null): boolean {
  return value === 'UsageLimitExceeded'
    || value === 'UsageLimitReached'
    || value === 'usageLimitExceeded'
    || value === 'usage_limit_exceeded'
    || value === 'usage_limit_reached';
}

function normalizeProviderCode(value: string | null): string | null {
  return value ? value.trim().toLowerCase() : null;
}

function containsAuthTokenInvalidatedMessage(text: string): boolean {
  return /authentication\s+token\s+has\s+been\s+invalidated/i.test(text);
}

function containsOauthTokenInvalidatedMessage(text: string): boolean {
  return /invalidated\s+oauth\s+token/i.test(text);
}

function containsRefreshTokenFailureMessage(text: string): boolean {
  return /refresh\s+token\s+has\s+already\s+been\s+used/i.test(text)
    || /refresh\s+token\s+was\s+already\s+used/i.test(text)
    || /refresh\s+token\s+(?:(?:has\s+been|was)\s+)?(?:invalidated|revoked)/i.test(text);
}

function readResetAtMs(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return Math.trunc(value < 10_000_000_000 ? value * 1000 : value);
  }
  const text = readString(value);
  if (!text) return null;
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function readRetryAfterMs(value: unknown): number | null {
  const numeric = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.trim()) : NaN;
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  return Math.trunc(numeric);
}

const monthIndexByName = new Map([
  ['january', 0],
  ['jan', 0],
  ['february', 1],
  ['feb', 1],
  ['march', 2],
  ['mar', 2],
  ['april', 3],
  ['apr', 3],
  ['may', 4],
  ['june', 5],
  ['jun', 5],
  ['july', 6],
  ['jul', 6],
  ['august', 7],
  ['aug', 7],
  ['september', 8],
  ['sep', 8],
  ['sept', 8],
  ['october', 9],
  ['oct', 9],
  ['november', 10],
  ['nov', 10],
  ['december', 11],
  ['dec', 11],
]);

function parsePeriodHour(rawHour: number, period: string | undefined): number | null {
  if (!Number.isInteger(rawHour) || rawHour < 1 || rawHour > 12) return null;
  let hour = rawHour % 12;
  if (period?.toUpperCase() === 'PM') hour += 12;
  return hour;
}

function readStableFullDateRetryTimeResetAtMs(text: string): number | null {
  const match = /\btry\s+again\s+at\s+([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?,\s*(\d{4})\s+(\d{1,2})(?::(\d{2}))?\s*(AM|PM)\b/iu.exec(text);
  if (!match) return null;
  const monthIndex = monthIndexByName.get(match[1]?.toLowerCase() ?? '');
  const day = Number(match[2]);
  const year = Number(match[3]);
  const rawHour = Number(match[4]);
  const minute = Number(match[5] ?? '00');
  const hour = parsePeriodHour(rawHour, match[6]);
  if (monthIndex === undefined || hour === null) return null;
  if (!Number.isInteger(year) || year < 1970 || !Number.isInteger(day) || day < 1 || day > 31) return null;
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return null;
  const candidate = new Date(year, monthIndex, day, hour, minute, 0, 0);
  if (
    candidate.getFullYear() !== year
    || candidate.getMonth() !== monthIndex
    || candidate.getDate() !== day
  ) {
    return null;
  }
  const parsed = candidate.getTime();
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function readStableRetryTimeResetAtMs(text: string, nowMs: number): number | null {
  const fullDateResetAtMs = readStableFullDateRetryTimeResetAtMs(text);
  if (fullDateResetAtMs !== null) return fullDateResetAtMs;

  const match = /\btry\s+again\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(AM|PM)\b/iu.exec(text);
  if (!match) return null;
  const hourText = match[1];
  const minuteText = match[2] ?? '00';
  const period = match[3]?.toUpperCase();
  const rawHour = Number(hourText);
  const minute = Number(minuteText);
  const hour = parsePeriodHour(rawHour, period);
  if (hour === null || !Number.isInteger(minute)) return null;
  if (minute < 0 || minute > 59) return null;
  const now = new Date(nowMs);
  const candidate = new Date(now.getTime());
  candidate.setHours(hour, minute, 0, 0);
  if (candidate.getTime() <= nowMs) {
    candidate.setDate(candidate.getDate() + 1);
  }
  const parsed = candidate.getTime();
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function buildClassification(
  input: ClassifyCodexConnectedServiceAuthFailureInput,
  params: Readonly<{
    kind: CodexConnectedServiceRuntimeFailureKind;
    limitCategory?: CodexConnectedServiceRuntimeFailureClassification['limitCategory'];
    resetsAtMs?: number | null;
    retryAfterMs?: number | null;
    planType?: string | null;
    rateLimits?: unknown | null;
    source: CodexConnectedServiceRuntimeFailureClassification['source'];
    recoveryAction?: CodexConnectedServiceRecoveryAction | null;
  }>,
): CodexConnectedServiceRuntimeFailureClassification {
  return {
    kind: params.kind,
    ...(params.limitCategory ? { limitCategory: params.limitCategory } : {}),
    serviceId: input.serviceId,
    profileId: input.profileId,
    groupId: input.groupId,
    resetsAtMs: params.resetsAtMs ?? null,
    retryAfterMs: params.retryAfterMs ?? null,
    planType: params.planType ?? null,
    rateLimits: params.rateLimits ?? null,
    source: params.source,
    ...(params.recoveryAction ? { recoveryAction: params.recoveryAction } : {}),
  };
}

// Usage-limit (capacity) recovery is distinct from provider state-sharing capability.
// Quota recovery is satisfied by a fresh/different account or proven fresh quota, not by
// sharing vendor continuity state. Keep `provider_state_sharing_required` reserved for
// genuine continuity/state-sharing failures.
const codexUsageLimitRecoveryAction = { kind: 'quota_recovery_required' } as const;

export function classifyCodexConnectedServiceAuthFailure(
  input: ClassifyCodexConnectedServiceAuthFailureInput,
): CodexConnectedServiceRuntimeFailureClassification | null {
  const record = readErrorRecord(input.error);
  const codexErrorInfo = readString(record?.codexErrorInfo ?? record?.codex_error_info);
  const structuredCode = readString(record?.code ?? record?.type ?? record?.reason);
  if (isStructuredUsageLimitCode(codexErrorInfo) || isStructuredUsageLimitCode(structuredCode)) {
    const text = readErrorText(input.error);
    return buildClassification(input, {
      kind: 'usage_limit',
      limitCategory: 'quota',
      resetsAtMs:
        readResetAtMs(record?.resetsAt ?? record?.resets_at)
        ?? readStableRetryTimeResetAtMs(text, input.nowMs ?? Date.now()),
      retryAfterMs: readRetryAfterMs(record?.retryAfterMs ?? record?.retry_after_ms),
      planType: readString(record?.planType ?? record?.plan_type),
      rateLimits: record?.rateLimits ?? record?.rate_limits ?? null,
      source: 'structured_provider_error',
      recoveryAction: codexUsageLimitRecoveryAction,
    });
  }

  const text = readErrorText(input.error);
  if (text.includes(CODEX_ACCOUNT_CHANGED_MESSAGE)) {
    return buildClassification(input, {
      kind: 'account_changed',
      limitCategory: 'auth',
      source: record ? 'structured_provider_error' : 'stable_provider_message',
    });
  }

  if (!input.providerErrorPath) return null;

  const providerCode = normalizeProviderCode(structuredCode ?? codexErrorInfo);
  if ((providerCode && refreshFailedProviderCodes.has(providerCode)) || containsRefreshTokenFailureMessage(text)) {
    return buildClassification(input, {
      kind: 'refresh_failed',
      limitCategory: 'auth',
      source: record ? 'structured_provider_error' : 'stable_provider_message',
    });
  }

  if (
    (providerCode && authExpiredProviderCodes.has(providerCode))
    || containsAuthTokenInvalidatedMessage(text)
    || containsOauthTokenInvalidatedMessage(text)
  ) {
    return buildClassification(input, {
      kind: 'auth_expired',
      limitCategory: 'auth',
      source: record ? 'structured_provider_error' : 'stable_provider_message',
    });
  }

  const generic = classifyPrimarySessionRuntimeIssue({
    provider: 'codex',
    cause: 'status_error',
    error: input.error,
  });
  if (generic.source === 'usage_limit') {
    return buildClassification(input, {
      kind: 'usage_limit',
      limitCategory: 'quota',
      resetsAtMs: readStableRetryTimeResetAtMs(text, input.nowMs ?? Date.now()),
      source: 'stable_provider_message',
      recoveryAction: codexUsageLimitRecoveryAction,
    });
  }
  if (generic.source === 'auth_error') {
    return buildClassification(input, {
      kind: 'auth_expired',
      limitCategory: 'auth',
      source: 'stable_provider_message',
    });
  }
  if (generic.source === 'permission_blocked') {
    return buildClassification(input, {
      kind: 'permission_denied',
      limitCategory: 'plan',
      source: 'stable_provider_message',
    });
  }
  return null;
}
