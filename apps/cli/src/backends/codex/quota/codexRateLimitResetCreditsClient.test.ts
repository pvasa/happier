import { describe, expect, it, vi } from 'vitest';

import {
  consumeCodexRateLimitResetCredit,
  fetchCodexRateLimitResetCredits,
} from './codexRateLimitResetCreditsClient';

describe('codexRateLimitResetCreditsClient', () => {
  it('reads Codex reset-credit inventory with connected account headers', async () => {
    const fetchRuntime = vi.fn(async (_url: string, _init: RequestInit): Promise<Response> => ({
      ok: true,
      status: 200,
      json: async () => ({ available_count: 2, credits: [] }),
    } as Response));

    await expect(fetchCodexRateLimitResetCredits({
      accessToken: 'access-token',
      accountId: 'acct-1',
      resetCreditsUrl: 'https://chatgpt.example.test/backend-api/wham/rate-limit-reset-credits',
      fetchRuntime,
    })).resolves.toEqual({
      ok: true,
      response: { available_count: 2, credits: [] },
    });

    expect(fetchRuntime).toHaveBeenCalledWith(
      'https://chatgpt.example.test/backend-api/wham/rate-limit-reset-credits',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer access-token',
          'ChatGPT-Account-Id': 'acct-1',
          Accept: 'application/json',
        }),
      }),
    );
  });

  it('posts to the Codex reset-credit consume endpoint with a credit-id JSON body', async () => {
    const fetchRuntime = vi.fn(async (_url: string, _init: RequestInit): Promise<Response> => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    } as Response));

    await expect(consumeCodexRateLimitResetCredit({
      accessToken: 'access-token',
      accountId: 'acct-1',
      creditId: 'credit-1',
      redeemRequestId: 'reset-req-1',
      consumeUrl: 'https://chatgpt.example.test/backend-api/wham/rate-limit-reset-credits/consume',
      fetchRuntime,
    })).resolves.toEqual({
      ok: true,
      response: { ok: true },
    });

    expect(fetchRuntime).toHaveBeenCalledWith(
      'https://chatgpt.example.test/backend-api/wham/rate-limit-reset-credits/consume',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer access-token',
          'ChatGPT-Account-Id': 'acct-1',
          'Content-Type': 'application/json',
          Accept: 'application/json',
        }),
        body: JSON.stringify({ credit_id: 'credit-1', redeem_request_id: 'reset-req-1' }),
      }),
    );
  });

  it('rejects a consume request with no credit id', async () => {
    const fetchRuntime = vi.fn();

    await expect(consumeCodexRateLimitResetCredit({
      accessToken: 'access-token',
      accountId: 'acct-1',
      creditId: '   ',
      redeemRequestId: 'reset-req-1',
      consumeUrl: 'https://chatgpt.example.test/backend-api/wham/rate-limit-reset-credits/consume',
      fetchRuntime,
    })).resolves.toEqual({
      ok: false,
      errorCode: 'codex_reset_credit_consume_failed',
      providerCode: 'missing_credit_id',
    });
    expect(fetchRuntime).not.toHaveBeenCalled();
  });

  it('returns provider status details for rejected reset-credit consume requests', async () => {
    const fetchRuntime = vi.fn(async (_url: string, _init: RequestInit): Promise<Response> => ({
      ok: false,
      status: 409,
      statusText: 'Conflict',
      json: async () => ({ code: 'no_available_reset_credits' }),
    } as Response));

    await expect(consumeCodexRateLimitResetCredit({
      accessToken: 'access-token',
      accountId: null,
      creditId: 'credit-1',
      redeemRequestId: 'reset-req-1',
      consumeUrl: 'https://chatgpt.example.test/backend-api/wham/rate-limit-reset-credits/consume',
      fetchRuntime,
    })).resolves.toEqual({
      ok: false,
      errorCode: 'codex_reset_credit_consume_failed',
      status: 409,
      providerCode: 'no_available_reset_credits',
    });
  });
});
