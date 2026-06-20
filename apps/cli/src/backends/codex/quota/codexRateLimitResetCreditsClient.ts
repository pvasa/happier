export const DEFAULT_CODEX_RATE_LIMIT_RESET_CREDITS_URL =
  'https://chatgpt.com/backend-api/wham/rate-limit-reset-credits';

export const DEFAULT_CODEX_RATE_LIMIT_RESET_CREDIT_CONSUME_URL =
  'https://chatgpt.com/backend-api/wham/rate-limit-reset-credits/consume';

export type CodexRateLimitResetCreditsFetch = (url: string, init: RequestInit) => Promise<Response>;

export type FetchCodexRateLimitResetCreditsResult =
  | Readonly<{ ok: true; response: unknown | null }>
  | Readonly<{
      ok: false;
      errorCode: 'codex_reset_credit_fetch_failed' | 'codex_reset_credit_fetch_network_error';
      status?: number;
      providerCode?: string | null;
    }>;

export type ConsumeCodexRateLimitResetCreditResult =
  | Readonly<{ ok: true; response: unknown | null }>
  | Readonly<{
      ok: false;
      errorCode: 'codex_reset_credit_consume_failed' | 'codex_reset_credit_consume_network_error';
      status?: number;
      providerCode?: string | null;
    }>;

function readProviderCode(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const direct = record.code ?? record.error_code ?? record.errorCode;
  if (typeof direct === 'string' && direct.trim()) return direct.trim();
  const error = record.error;
  if (!error || typeof error !== 'object' || Array.isArray(error)) return null;
  const nested = (error as Record<string, unknown>).code ?? (error as Record<string, unknown>).error_code;
  return typeof nested === 'string' && nested.trim() ? nested.trim() : null;
}

async function readJsonBestEffort(response: Response): Promise<unknown | null> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export async function fetchCodexRateLimitResetCredits(params: Readonly<{
  accessToken: string;
  accountId?: string | null;
  resetCreditsUrl?: string;
  fetchRuntime?: CodexRateLimitResetCreditsFetch;
}>): Promise<FetchCodexRateLimitResetCreditsResult> {
  const accessToken = params.accessToken.trim();
  if (!accessToken) {
    return {
      ok: false,
      errorCode: 'codex_reset_credit_fetch_failed',
      providerCode: 'missing_access_token',
    };
  }

  const fetchRuntime = params.fetchRuntime ?? fetch;
  try {
    const response = await fetchRuntime(
      params.resetCreditsUrl ?? DEFAULT_CODEX_RATE_LIMIT_RESET_CREDITS_URL,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          ...(params.accountId ? { 'ChatGPT-Account-Id': params.accountId } : {}),
          Accept: 'application/json',
        },
      },
    );
    const json = await readJsonBestEffort(response);
    if (!response.ok) {
      return {
        ok: false,
        errorCode: 'codex_reset_credit_fetch_failed',
        status: response.status,
        providerCode: readProviderCode(json),
      };
    }
    return { ok: true, response: json };
  } catch {
    return { ok: false, errorCode: 'codex_reset_credit_fetch_network_error' };
  }
}

export async function consumeCodexRateLimitResetCredit(params: Readonly<{
  accessToken: string;
  accountId?: string | null;
  idempotencyKey: string;
  consumeUrl?: string;
  fetchRuntime?: CodexRateLimitResetCreditsFetch;
  signal?: AbortSignal;
}>): Promise<ConsumeCodexRateLimitResetCreditResult> {
  const accessToken = params.accessToken.trim();
  const idempotencyKey = params.idempotencyKey.trim();
  if (!accessToken) {
    return {
      ok: false,
      errorCode: 'codex_reset_credit_consume_failed',
      providerCode: 'missing_access_token',
    };
  }
  if (!idempotencyKey) {
    return {
      ok: false,
      errorCode: 'codex_reset_credit_consume_failed',
      providerCode: 'missing_idempotency_key',
    };
  }

  const fetchRuntime = params.fetchRuntime ?? fetch;
  try {
    const response = await fetchRuntime(
      params.consumeUrl ?? DEFAULT_CODEX_RATE_LIMIT_RESET_CREDIT_CONSUME_URL,
      {
        method: 'POST',
        signal: params.signal,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          ...(params.accountId ? { 'ChatGPT-Account-Id': params.accountId } : {}),
          'Idempotency-Key': idempotencyKey,
          Accept: 'application/json',
        },
      },
    );
    const json = await readJsonBestEffort(response);
    if (!response.ok) {
      return {
        ok: false,
        errorCode: 'codex_reset_credit_consume_failed',
        status: response.status,
        providerCode: readProviderCode(json),
      };
    }
    return { ok: true, response: json };
  } catch {
    return { ok: false, errorCode: 'codex_reset_credit_consume_network_error' };
  }
}
