import { describe, expect, it, vi } from 'vitest';

import { ConnectedServiceQuotaSnapshotV1Schema, buildConnectedServiceCredentialRecord } from '@happier-dev/protocol';

import { createOpenAiCodexQuotaFetcher } from './openAiCodexQuotaFetcher';

describe('createOpenAiCodexQuotaFetcher', () => {
  it('polls the ChatGPT wham usage endpoint by default with connected account headers', async () => {
    const now = 1_000_000;
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        plan_type: 'pro',
        rate_limit: {
          primary_window: { used_percent: 10, reset_at: 1700000000 },
          secondary_window: { used_percent: 25, reset_at: 1700003600 },
        },
      }),
    }));
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const record = buildConnectedServiceCredentialRecord({
      now,
      serviceId: 'openai-codex',
      profileId: 'work',
      kind: 'oauth',
      expiresAt: now + 60_000,
      oauth: {
        accessToken: 'at',
        refreshToken: 'rt',
        idToken: null,
        scope: null,
        tokenType: null,
        providerAccountId: 'acct',
        providerEmail: 'user@example.com',
      },
    });

    const fetcher = createOpenAiCodexQuotaFetcher();
    const snapshot = await fetcher.fetch({ record, now, signal: new AbortController().signal });
    expect(snapshot?.serviceId).toBe('openai-codex');
    expect(fetchMock).toHaveBeenCalledWith('https://chatgpt.com/backend-api/wham/usage', expect.objectContaining({
      method: 'GET',
      headers: expect.objectContaining({
        Authorization: 'Bearer at',
        'ChatGPT-Account-Id': 'acct',
      }),
    }));
  });

  it('fetches and parses approved OpenAI Codex usage proxy data into a quota snapshot', async () => {
    const now = 1_000_000;
    const fetchMock = vi.fn(async (_input: unknown, _init?: unknown) => ({
      ok: true,
      json: async () => ({
        plan_type: 'pro',
        rate_limit: {
          primary_window: { used_percent: 10, reset_at: 1700000000 },
          secondary_window: { used_percent: 25, reset_at: 1700003600 },
        },
      }),
    }));
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const record = buildConnectedServiceCredentialRecord({
      now,
      serviceId: 'openai-codex',
      profileId: 'work',
      kind: 'oauth',
      expiresAt: now + 60_000,
      oauth: {
        accessToken: 'at',
        refreshToken: 'rt',
        idToken: null,
        scope: null,
        tokenType: null,
        providerAccountId: 'acct',
        providerEmail: 'user@example.com',
      },
    });

    const fetcher = createOpenAiCodexQuotaFetcher({
      usageUrl: 'https://quota.happier.dev/openai-codex/usage',
      staleAfterMs: 300_000,
    });

    const snapshot = await fetcher.fetch({ record, now, signal: new AbortController().signal });
    const parsed = ConnectedServiceQuotaSnapshotV1Schema.safeParse(snapshot);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.planLabel).toBe('pro');
      expect(parsed.data.meters.map((m) => m.meterId)).toEqual(['session', 'weekly']);
    }

    const init: unknown = fetchMock.mock.calls[0]?.[1];
    const headers: unknown =
      init && typeof init === 'object' && 'headers' in init ? (init as { headers?: unknown }).headers : undefined;
    if (headers && typeof headers === 'object' && 'get' in headers && typeof headers.get === 'function') {
      expect(String(headers.get('Authorization'))).toBe('Bearer at');
      expect(String(headers.get('ChatGPT-Account-Id'))).toBe('acct');
    } else {
      const headerRecord = headers && typeof headers === 'object' && !Array.isArray(headers) ? (headers as Record<string, unknown>) : {};
      expect(headerRecord.Authorization).toBe('Bearer at');
      expect(headerRecord['ChatGPT-Account-Id']).toBe('acct');
    }
  });

  it('allows an explicitly configured ChatGPT wham usage endpoint', async () => {
    const now = 1_000_000;
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        rate_limit: {
          primary_window: { used_percent: 55, reset_at: 1700000000 },
        },
      }),
    }));
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const record = buildConnectedServiceCredentialRecord({
      now,
      serviceId: 'openai-codex',
      profileId: 'work',
      kind: 'oauth',
      expiresAt: now + 60_000,
      oauth: {
        accessToken: 'at',
        refreshToken: 'rt',
        idToken: null,
        scope: null,
        tokenType: null,
        providerAccountId: 'acct',
        providerEmail: 'user@example.com',
      },
    });

    const fetcher = createOpenAiCodexQuotaFetcher({
      usageUrl: 'https://chatgpt.com/backend-api/wham/usage',
      staleAfterMs: 300_000,
    });

    const snapshot = await fetcher.fetch({ record, now, signal: new AbortController().signal });
    expect(snapshot?.meters.find((meter) => meter.meterId === 'session')?.utilizationPct).toBe(55);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('exposes Retry-After backoff from non-ok provider responses', async () => {
    const now = 1_000_000;
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
      headers: {
        get: (name: string) => name.toLowerCase() === 'retry-after' ? '120' : null,
      },
    })) as unknown as typeof fetch);

    const record = buildConnectedServiceCredentialRecord({
      now,
      serviceId: 'openai-codex',
      profileId: 'work',
      kind: 'oauth',
      expiresAt: now + 60_000,
      oauth: {
        accessToken: 'at',
        refreshToken: 'rt',
        idToken: null,
        scope: null,
        tokenType: null,
        providerAccountId: 'acct',
        providerEmail: 'user@example.com',
      },
    });

    const fetcher = createOpenAiCodexQuotaFetcher();

    await expect(fetcher.fetch({ record, now, signal: new AbortController().signal }))
      .rejects
      .toMatchObject({
        status: 503,
        retryAfterMs: 120_000,
      });
  });

  it('converts relative resets_in_seconds windows to absolute resets and drops implausible 1970-era epochs (RD-QUO-1)', async () => {
    const now = Date.parse('2026-06-11T10:00:00.000Z');
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        plan_type: 'pro',
        rate_limit: {
          // Legacy relative shape: no absolute reset, only seconds-until-reset.
          primary_window: { used_percent: 100, window_minutes: 300, resets_in_seconds: 1_800 },
          // A relative value misparsed as an epoch would land in 1970 — must be dropped.
          secondary_window: { used_percent: 25, reset_at: 86_400 },
        },
      }),
    }));
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const record = buildConnectedServiceCredentialRecord({
      now,
      serviceId: 'openai-codex',
      profileId: 'work',
      kind: 'oauth',
      expiresAt: now + 60_000,
      oauth: {
        accessToken: 'at',
        refreshToken: 'rt',
        idToken: null,
        scope: null,
        tokenType: null,
        providerAccountId: 'acct',
        providerEmail: 'user@example.com',
      },
    });

    const fetcher = createOpenAiCodexQuotaFetcher();
    const snapshot = await fetcher.fetch({ record, now, signal: new AbortController().signal });
    const parsed = ConnectedServiceQuotaSnapshotV1Schema.parse(snapshot);
    expect(parsed.meters).toMatchObject([
      { meterId: 'session', resetsAt: now + 1_800_000 },
      { meterId: 'weekly', resetsAt: null },
    ]);
  });
});
