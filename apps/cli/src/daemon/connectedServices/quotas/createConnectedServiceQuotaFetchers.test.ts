import { describe, expect, it, vi } from 'vitest';

import { buildConnectedServiceCredentialRecord } from '@happier-dev/protocol';

import { createConnectedServiceQuotaFetchers } from './createConnectedServiceQuotaFetchers';

describe('createConnectedServiceQuotaFetchers', () => {
  it('uses direct provider quota endpoints when no proxy URL is configured', async () => {
    const now = 1_000_000;
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        rate_limit: {
          primary_window: { used_percent: 10, reset_at: 1700000000 },
        },
      }),
    }));
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const fetchers = createConnectedServiceQuotaFetchers({});
    const openAiFetcher = fetchers.find((fetcher) => fetcher.serviceId === 'openai-codex');
    expect(openAiFetcher).toBeTruthy();

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
        providerAccountId: null,
        providerEmail: null,
      },
    });

    await expect(openAiFetcher!.fetch({ record, now, signal: new AbortController().signal }))
      .resolves
      .toMatchObject({ serviceId: 'openai-codex', profileId: 'work' });
    expect(fetchMock).toHaveBeenCalledWith('https://chatgpt.com/backend-api/wham/usage', expect.anything());
  });

  it('assigns provider-specific quota polling cadence without shared coordinator provider branching', () => {
    const fetchers = createConnectedServiceQuotaFetchers({});
    const openAiFetcher = fetchers.find((fetcher) => fetcher.serviceId === 'openai-codex') as
      | { pollPolicy?: { minPollIntervalMs?: number } }
      | undefined;
    const claudeFetcher = fetchers.find((fetcher) => fetcher.serviceId === 'claude-subscription') as
      | { pollPolicy?: { minPollIntervalMs?: number; retryAfterBackoffMinMs?: number } }
      | undefined;

    expect(openAiFetcher?.pollPolicy?.minPollIntervalMs).toBe(5 * 60_000);
    expect(claudeFetcher?.pollPolicy?.minPollIntervalMs).toBe(30 * 60_000);
    expect(claudeFetcher?.pollPolicy?.retryAfterBackoffMinMs).toBe(15 * 60_000);
  });
});
