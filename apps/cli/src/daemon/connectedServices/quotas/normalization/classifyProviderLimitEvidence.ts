export type ProviderLimitCategory =
  | 'quota'
  | 'rate_limit'
  | 'capacity'
  | 'auth'
  | 'plan'
  | 'validation'
  | 'account_disabled'
  | 'unknown';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function collectText(value: unknown, output: string[]): void {
  if (typeof value === 'string') {
    output.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectText(item, output);
    return;
  }
  if (!isRecord(value)) return;
  for (const key of ['name', 'code', 'type', 'reason', 'status', 'message', 'detail', 'details', 'error']) {
    collectText(value[key], output);
  }
}

export function classifyProviderLimitEvidence(value: unknown): ProviderLimitCategory {
  const record = isRecord(value) ? value : null;
  const status = typeof record?.status === 'number' ? record.status : Number(record?.status);
  const textParts: string[] = [];
  collectText(value, textParts);
  const text = textParts.join(' ').toLowerCase();
  const code = normalizeString(record?.code ?? record?.type ?? record?.reason ?? record?.name)?.toLowerCase() ?? '';

  if (/\b(account|user)\s+(disabled|banned|suspended|deactivated)\b/u.test(text)) return 'account_disabled';
  if (/\b(usage_limit_reached|usage_limit_exceeded|usagelimitreached|usagelimitexceeded|freeusagelimiterror)\b/u.test(code)) return 'quota';
  if (/\b(go_usage_limit|gousagelimiterror|account_rate_limit|rate_limit|ratelimit|rate limit|too many requests)\b/u.test(`${code} ${text}`)) return 'rate_limit';
  if (/\b(resource_exhausted|quota|usage limit|limit reached|out of credits|credits exhausted)\b/u.test(`${code} ${text}`)) return 'quota';
  if (status === 401 || /\b(unauthorized|unauthenticated|authentication|invalid api key|invalid token|login required|not logged in)\b/u.test(text)) return 'auth';
  if (status === 403 && /\b(scope|permission|auth|token|credential)\b/u.test(text)) return 'auth';
  if (status === 402 || /\b(upgrade|plan|billing|payment required|subscription|permission denied|not entitled|entitlement)\b/u.test(text)) return 'plan';
  if (/\b(capacity|overloaded|server overload|model overload|unavailable)\b/u.test(text)) return 'capacity';
  if (status === 400 || /\b(validation|invalid request|bad request|malformed)\b/u.test(text)) return 'validation';
  if (status === 429) return 'rate_limit';
  return 'unknown';
}
