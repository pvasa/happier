import { ConnectedServiceQuotaFetchError, type ConnectedServiceQuotaFetcher } from '../types';
import type { ConnectedServiceCredentialRecordV1, ConnectedServiceQuotaMeterV1 } from '@happier-dev/protocol';

import { isRecord, normalizeNonEmptyString, normalizePct, resolveConnectedServiceQuotaAccountLabel } from '../quotaNormalization';
import { parseRetryAfterHeader } from '../normalization';

const RESET_AT_PLAUSIBILITY_FLOOR_TOLERANCE_MS = 24 * 60 * 60_000;

function normalizeResetAtMs(value: unknown, nowMs: number): number | null {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num) || num <= 0) return null;
  // Heuristic: usage APIs commonly return unix seconds.
  const epochMs = num > 1_000_000_000_000 ? Math.trunc(num) : Math.trunc(num * 1000);
  // Sanity floor (RD-QUO-1): a relative-seconds value misparsed as an epoch lands in the
  // 1970 era. Reject resets implausibly far in the past instead of persisting bogus data.
  if (epochMs < nowMs - RESET_AT_PLAUSIBILITY_FLOOR_TOLERANCE_MS) return null;
  return epochMs;
}

function normalizeWindowResetAtMs(window: Record<string, unknown> | null, nowMs: number): number | null {
  if (!window) return null;
  const absolute = normalizeResetAtMs(window.reset_at ?? window.resets_at ?? window.resetAt ?? window.resetsAt, nowMs);
  if (absolute !== null) return absolute;
  // Legacy relative shape: seconds-until-reset converted at fetch time.
  const seconds = typeof window.resets_in_seconds === 'number'
    ? window.resets_in_seconds
    : typeof window.resetsInSeconds === 'number'
      ? window.resetsInSeconds
      : null;
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return null;
  return Math.trunc(nowMs + seconds * 1000);
}

function resolveAccountLabel(record: ConnectedServiceCredentialRecordV1): string | null {
  return resolveConnectedServiceQuotaAccountLabel(record);
}

function readProviderCodeFromBody(body: unknown): string | null {
  if (!isRecord(body)) return null;
  const code = body.code ?? body.error_code ?? body.errorCode;
  if (typeof code === 'string' && code.trim()) return code.trim();
  const errorRecord = isRecord(body.error) ? body.error : null;
  if (errorRecord) {
    const innerCode = errorRecord.code ?? errorRecord.error_code;
    if (typeof innerCode === 'string' && innerCode.trim()) return innerCode.trim();
  }
  return null;
}

/**
 * Builds a quota-unknown meter placeholder for the given meterId.
 * Used when the endpoint is disabled or data is unavailable.
 */
function buildQuotaUnknownMeter(meterId: string, label: string): ConnectedServiceQuotaMeterV1 {
  return {
    meterId,
    label,
    used: null,
    limit: null,
    unit: 'unknown',
    utilizationPct: null,
    resetsAt: null,
    status: 'unavailable',
    details: { code: 'quota_unknown' },
  };
}

const DEFAULT_OPENAI_CODEX_USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage';

export function createOpenAiCodexQuotaFetcher(params?: Readonly<{
  usageUrl?: string;
  staleAfterMs?: number;
  userAgent?: string;
  /**
   * When true, skip the private endpoint entirely and return a quota_unknown
   * snapshot. Equivalent to setting HAPPIER_CONNECTED_SERVICES_DISABLE_CODEX_QUOTA_ENDPOINT=1.
   * The per-call usageUrl override (if set) takes precedence over this flag.
   */
  disablePrivateEndpoint?: boolean;
}>): ConnectedServiceQuotaFetcher {
  const usageUrl = typeof params?.usageUrl === 'string' && params.usageUrl.trim()
    ? params.usageUrl.trim()
    : DEFAULT_OPENAI_CODEX_USAGE_URL;
  const disablePrivateEndpoint = params?.disablePrivateEndpoint === true
    && usageUrl === DEFAULT_OPENAI_CODEX_USAGE_URL;
  const staleAfterMs = typeof params?.staleAfterMs === 'number' && Number.isFinite(params.staleAfterMs) ? Math.max(1, Math.trunc(params.staleAfterMs)) : 300_000;
  const userAgent = params?.userAgent ?? 'happier';

  return {
    serviceId: 'openai-codex',
    pollPolicy: {
      minPollIntervalMs: 5 * 60_000,
    },
    fetch: async ({ record, now, signal }) => {
      if (record.kind !== 'oauth') {
        throw new ConnectedServiceQuotaFetchError(
          'OpenAI Codex quota requires an OAuth credential record',
          { quotaFetchErrorCode: 'missing_auth' },
        );
      }

      // Kill-switch: skip private endpoint and return quota_unknown placeholder.
      // The usageUrl override (non-default URL) takes precedence — it is the documented
      // escape hatch and indicates the caller wants to use a specific endpoint.
      if (disablePrivateEndpoint) {
        return {
          v: 1,
          serviceId: record.serviceId,
          profileId: record.profileId,
          fetchedAt: now,
          staleAfterMs,
          planLabel: null,
          accountLabel: resolveAccountLabel(record),
          meters: [
            buildQuotaUnknownMeter('session', 'Session'),
            buildQuotaUnknownMeter('weekly', 'Weekly'),
          ],
        };
      }

      let response: Response;
      try {
        response = await fetch(usageUrl, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${record.oauth.accessToken}`,
            ...(record.oauth.providerAccountId ? { 'ChatGPT-Account-Id': record.oauth.providerAccountId } : {}),
            'Accept': 'application/json',
            'User-Agent': userAgent,
          },
          signal,
        });
      } catch (fetchErr) {
        throw new ConnectedServiceQuotaFetchError(
          `OpenAI usage fetch network error: ${fetchErr instanceof Error ? fetchErr.message : String(fetchErr)}`,
          { quotaFetchErrorCode: 'network' },
        );
      }

      if (!response.ok) {
        const retryAfter = parseRetryAfterHeader(response.headers?.get?.('retry-after'), { nowMs: now });

        // Attempt to read a provider code from the response body (best-effort).
        let providerCode: string | null = null;
        try {
          const body = await response.json() as unknown;
          providerCode = readProviderCodeFromBody(body);
        } catch {
          // Ignore body parse errors on non-ok responses.
        }

        const quotaFetchErrorCode = response.status === 401 ? 'auth_failure' : 'provider_backoff';
        throw new ConnectedServiceQuotaFetchError(
          `OpenAI usage fetch failed (${response.status}): ${response.statusText}`,
          {
            status: response.status,
            retryAfterMs: retryAfter.retryAfterMs,
            quotaFetchErrorCode,
            providerCode,
          },
        );
      }

      let json: unknown;
      try {
        json = await response.json();
      } catch (parseErr) {
        throw new ConnectedServiceQuotaFetchError(
          `OpenAI usage response body is malformed: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`,
          { quotaFetchErrorCode: 'malformed' },
        );
      }

      const data = isRecord(json) ? json : {};

      const planLabel = normalizeNonEmptyString(data.plan_type);
      const rateLimit = isRecord(data.rate_limit) ? data.rate_limit : null;
      const primary = rateLimit && isRecord(rateLimit.primary_window) ? rateLimit.primary_window : null;
      const secondary = rateLimit && isRecord(rateLimit.secondary_window) ? rateLimit.secondary_window : null;

      const sessionPct = normalizePct(primary?.used_percent);
      const weeklyPct = normalizePct(secondary?.used_percent);

      return {
        v: 1,
        serviceId: record.serviceId,
        profileId: record.profileId,
        fetchedAt: now,
        staleAfterMs,
        planLabel,
        accountLabel: resolveAccountLabel(record),
        meters: [
          {
            meterId: 'session',
            label: 'Session',
            used: null,
            limit: null,
            unit: 'unknown',
            utilizationPct: sessionPct,
            resetsAt: normalizeWindowResetAtMs(primary, now),
            status: sessionPct === null ? 'unavailable' : 'ok',
            details: {},
          },
          {
            meterId: 'weekly',
            label: 'Weekly',
            used: null,
            limit: null,
            unit: 'unknown',
            utilizationPct: weeklyPct,
            resetsAt: normalizeWindowResetAtMs(secondary, now),
            status: weeklyPct === null ? 'unavailable' : 'ok',
            details: {},
          },
        ],
      };
    },
  };
}
