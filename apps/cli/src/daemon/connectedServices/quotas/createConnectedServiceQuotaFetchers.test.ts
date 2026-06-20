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

  it('does not reuse the generic Codex quota user-agent override for Claude usage polling', async () => {
    const now = 1_000_000;
    const fetchMock = vi.fn(async (input: unknown, _init?: unknown) => {
      const url = String(input ?? '');
      if (url.includes('/wham/usage')) {
        return {
          ok: true,
          json: async () => ({
            rate_limit: {
              primary_window: { used_percent: 10, reset_at: 1700000000 },
            },
          }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          five_hour: { utilization: 10, resets_at: '2026-02-16T00:00:00Z' },
        }),
      };
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const fetchers = createConnectedServiceQuotaFetchers({
      HAPPIER_CONNECTED_SERVICES_QUOTAS_USER_AGENT: 'codex-specific-agent/1.0',
    });
    const openAiFetcher = fetchers.find((fetcher) => fetcher.serviceId === 'openai-codex');
    const claudeFetcher = fetchers.find((fetcher) => fetcher.serviceId === 'claude-subscription');

    await openAiFetcher!.fetch({
      record: buildConnectedServiceCredentialRecord({
        now,
        serviceId: 'openai-codex',
        profileId: 'codex-work',
        kind: 'oauth',
        expiresAt: now + 60_000,
        oauth: {
          accessToken: 'codex-at',
          refreshToken: 'codex-rt',
          idToken: null,
          scope: null,
          tokenType: null,
          providerAccountId: null,
          providerEmail: null,
        },
      }),
      now,
      signal: new AbortController().signal,
    });
    await claudeFetcher!.fetch({
      record: buildConnectedServiceCredentialRecord({
        now,
        serviceId: 'claude-subscription',
        profileId: 'claude-work',
        kind: 'oauth',
        expiresAt: now + 60_000,
        oauth: {
          accessToken: 'claude-at',
          refreshToken: 'claude-rt',
          idToken: null,
          scope: 'user:inference user:profile user:sessions:claude_code user:mcp_servers user:file_upload',
          tokenType: null,
          providerAccountId: null,
          providerEmail: null,
        },
      }),
      now,
      signal: new AbortController().signal,
    });

    const codexHeaders = fetchMock.mock.calls.find((call) => String(call[0]).includes('/wham/usage'))
      ?.[1] as { headers?: Record<string, string> } | undefined;
    const claudeHeaders = fetchMock.mock.calls.find((call) => String(call[0]).includes('/api/oauth/usage'))
      ?.[1] as { headers?: Record<string, string> } | undefined;
    expect(codexHeaders?.headers?.['User-Agent']).toBe('codex-specific-agent/1.0');
    expect(claudeHeaders?.headers?.['User-Agent']).toMatch(/^claude-code\//u);
  });
});
