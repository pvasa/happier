/**
 * Kill-switch env: HAPPIER_CONNECTED_SERVICES_DISABLE_CODEX_QUOTA_ENDPOINT=1
 *
 * When set, the factory must produce a fetcher that skips the private endpoint
 * and returns a quota_unknown snapshot (X7 pattern) — falling back to stale-but-
 * usable via X8 if there is previous data, otherwise quota_unknown.
 */
import { describe, expect, it, vi, afterEach } from 'vitest';

import { buildConnectedServiceCredentialRecord } from '@happier-dev/protocol';

import { createConnectedServiceQuotaFetchers } from '../createConnectedServiceQuotaFetchers';

afterEach(() => {
  vi.restoreAllMocks();
});

function buildCodexRecord(now: number) {
  return buildConnectedServiceCredentialRecord({
    now,
    serviceId: 'openai-codex',
    profileId: 'work',
    kind: 'oauth',
    expiresAt: now + 60_000,
    oauth: {
      accessToken: 'tok',
      refreshToken: 'rt',
      idToken: null,
      scope: null,
      tokenType: null,
      providerAccountId: null,
      providerEmail: null,
    },
  });
}

describe('createConnectedServiceQuotaFetchers — kill-switch env', () => {
  it('skips the Codex private endpoint and returns quota_unknown when kill-switch env is set', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const fetchers = createConnectedServiceQuotaFetchers({
      HAPPIER_CONNECTED_SERVICES_DISABLE_CODEX_QUOTA_ENDPOINT: '1',
    });
    const codexFetcher = fetchers.find((f) => f.serviceId === 'openai-codex');
    expect(codexFetcher).toBeTruthy();

    const now = 1_000_000;
    const snapshot = await codexFetcher!.fetch({
      record: buildCodexRecord(now),
      now,
      signal: new AbortController().signal,
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(snapshot).not.toBeNull();
    expect(snapshot?.meters.every((m) => m.status === 'unavailable')).toBe(true);
    expect(snapshot?.meters.every((m) => m.details?.code === 'quota_unknown')).toBe(true);
  });

  it('uses the private Codex endpoint by default when kill-switch env is absent', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ rate_limit: { primary_window: { used_percent: 30 } } }),
    }));
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const fetchers = createConnectedServiceQuotaFetchers({});
    const codexFetcher = fetchers.find((f) => f.serviceId === 'openai-codex');
    const now = 1_000_000;
    await codexFetcher!.fetch({
      record: buildCodexRecord(now),
      now,
      signal: new AbortController().signal,
    });

    expect(fetchMock).toHaveBeenCalledWith('https://chatgpt.com/backend-api/wham/usage', expect.anything());
  });

  it('per-call usageUrl override takes precedence over the kill-switch env', async () => {
    // The per-call usageUrl is configured at factory time via env
    // HAPPIER_CONNECTED_SERVICES_OPENAI_CODEX_USAGE_URL — this is the documented escape hatch.
    // Even with kill-switch set, a custom usageUrl should be honoured.
    const customUrl = 'https://corp-proxy.example.com/codex-usage';
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ rate_limit: { primary_window: { used_percent: 10 } } }),
    }));
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const fetchers = createConnectedServiceQuotaFetchers({
      HAPPIER_CONNECTED_SERVICES_DISABLE_CODEX_QUOTA_ENDPOINT: '1',
      HAPPIER_CONNECTED_SERVICES_OPENAI_CODEX_USAGE_URL: customUrl,
    });
    const codexFetcher = fetchers.find((f) => f.serviceId === 'openai-codex');
    const now = 1_000_000;
    await codexFetcher!.fetch({
      record: buildCodexRecord(now),
      now,
      signal: new AbortController().signal,
    });

    // The usageUrl override takes precedence — the custom URL is called
    expect(fetchMock).toHaveBeenCalledWith(customUrl, expect.anything());
  });
});
