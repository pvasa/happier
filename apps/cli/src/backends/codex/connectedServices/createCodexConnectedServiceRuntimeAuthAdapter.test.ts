import { describe, expect, it, vi } from 'vitest';

import { buildConnectedServiceCredentialRecord } from '@happier-dev/protocol';

import { createCodexConnectedServiceRuntimeAuthAdapter } from './createCodexConnectedServiceRuntimeAuthAdapter';
import { ConnectedServiceAuthGroupRuntimeQuotaSnapshotStore } from '@/daemon/connectedServices/accountGroups/quotas/ConnectedServiceAuthGroupRuntimeQuotaSnapshotStore';

describe('createCodexConnectedServiceRuntimeAuthAdapter', () => {
  it('reports direct live hot apply support when runtime apply RPC is available', () => {
    const adapter = createCodexConnectedServiceRuntimeAuthAdapter();
    const applyConnectedServiceAuthGeneration = vi.fn();

    expect(adapter.canHotApply({
      target: { agentId: 'codex' },
      selection: {
        record: buildConnectedServiceCredentialRecord({
          now: 1_000,
          serviceId: 'openai-codex',
          profileId: 'work',
          kind: 'oauth',
          expiresAt: 2_000,
          oauth: {
            accessToken: 'access',
            refreshToken: 'refresh',
            idToken: 'id',
            scope: null,
            tokenType: null,
            providerAccountId: 'acct',
            providerEmail: 'codex-user@example.test',
          },
        }),
        applyConnectedServiceAuthGeneration,
      },
    })).toEqual({
      supported: true,
      mode: 'direct_live_hot_auth',
    });
  });

  it('reports restart recovery when runtime apply RPC is unavailable', () => {
    const adapter = createCodexConnectedServiceRuntimeAuthAdapter();

    expect(adapter.canHotApply({
      target: { agentId: 'codex' },
      selection: {
        record: buildConnectedServiceCredentialRecord({
          now: 1_000,
          serviceId: 'openai-codex',
          profileId: 'work',
          kind: 'oauth',
          expiresAt: 2_000,
          oauth: {
            accessToken: 'access',
            refreshToken: 'refresh',
            idToken: 'id',
            scope: null,
            tokenType: null,
            providerAccountId: 'acct',
            providerEmail: 'codex-user@example.test',
          },
        }),
      },
    })).toEqual({
      supported: false,
      reason: 'direct_live_hot_auth_unsupported',
      recovery: 'restart_resume',
    });
  });

  it('does not treat transport recycle hooks as direct live hot apply support', () => {
    const adapter = createCodexConnectedServiceRuntimeAuthAdapter();

    expect(adapter.canHotApply({
      target: { agentId: 'codex' },
      selection: {
        record: buildConnectedServiceCredentialRecord({
          now: 1_000,
          serviceId: 'openai-codex',
          profileId: 'work',
          kind: 'oauth',
          expiresAt: 2_000,
          oauth: {
            accessToken: 'access',
            refreshToken: 'refresh',
            idToken: 'id',
            scope: null,
            tokenType: null,
            providerAccountId: 'acct',
            providerEmail: 'codex-user@example.test',
          },
        }),
        invalidateTransports: async () => {},
        persistAuthStore: async () => {},
      },
    })).toEqual({
      supported: false,
      reason: 'direct_live_hot_auth_unsupported',
      recovery: 'restart_resume',
    });
  });

  it('uses direct live runtime apply before legacy transport recycle hooks', async () => {
    const adapter = createCodexConnectedServiceRuntimeAuthAdapter();
    const applyConnectedServiceAuthGeneration = vi.fn(async () => ({
      ok: true,
      appliedVia: 'direct_live_hot_auth',
      verification: { activeAccountId: 'acct' },
    }));
    const persistAuthStore = vi.fn(async () => {});
    const invalidateTransports = vi.fn(async () => {});
    const client = { request: vi.fn(async () => ({ ok: true })) };

    await expect(adapter.hotApply({
      target: { agentId: 'codex' },
      selection: {
        record: buildConnectedServiceCredentialRecord({
          now: 1_000,
          serviceId: 'openai-codex',
          profileId: 'work',
          kind: 'oauth',
          expiresAt: 2_000,
          oauth: {
            accessToken: 'access',
            refreshToken: 'refresh',
            idToken: 'id',
            scope: null,
            tokenType: null,
            providerAccountId: 'acct',
            providerEmail: 'codex-user@example.test',
          },
        }),
        client,
        applyConnectedServiceAuthGeneration,
        invalidateTransports,
        persistAuthStore,
        applyReason: 'usage_limit',
      },
    })).resolves.toEqual({
      applied: true,
      appliedVia: 'direct_live_hot_auth',
      verification: { activeAccountId: 'acct' },
    });

    expect(applyConnectedServiceAuthGeneration).toHaveBeenCalledWith(expect.objectContaining({
      serviceId: 'openai-codex',
      reason: 'usage_limit',
      requireDirectLiveHotApply: false,
      authGeneration: expect.objectContaining({
        credential: expect.any(Object),
      }),
    }));
    expect(client.request).not.toHaveBeenCalled();
    expect(persistAuthStore).not.toHaveBeenCalled();
    expect(invalidateTransports).not.toHaveBeenCalled();
  });

  it('reports failed direct-live durability as restart-required partial state with diagnostics', async () => {
    const adapter = createCodexConnectedServiceRuntimeAuthAdapter();
    const applyConnectedServiceAuthGeneration = vi.fn(async () => ({
      ok: true,
      appliedVia: 'direct_live_hot_auth',
      activeAccountId: 'acct_live',
      verification: {
        activeAccountId: 'acct_live',
        proofStrength: 'exact',
        source: 'applied_credential',
      },
      durability: {
        persisted: false,
        errorCode: 'auth_store_persistence_failed_after_live_apply',
      },
    }));

    await expect(adapter.hotApply({
      target: { agentId: 'codex' },
      selection: {
        record: buildConnectedServiceCredentialRecord({
          now: 1_000,
          serviceId: 'openai-codex',
          profileId: 'work',
          kind: 'oauth',
          expiresAt: 2_000,
          oauth: {
            accessToken: 'access',
            refreshToken: 'refresh',
            idToken: 'id',
            scope: null,
            tokenType: null,
            providerAccountId: 'acct_live',
            providerEmail: 'codex-user@example.test',
          },
        }),
        applyConnectedServiceAuthGeneration,
      },
    })).resolves.toEqual({
      applied: false,
      appliedVia: 'direct_live_hot_auth',
      activeAccountId: 'acct_live',
      partialState: 'runtime_auth_applied',
      recovery: 'restart_resume',
      reason: 'auth_store_persistence_failed_after_live_apply',
      error: 'auth_store_persistence_failed_after_live_apply',
      verification: {
        activeAccountId: 'acct_live',
        proofStrength: 'exact',
        source: 'applied_credential',
      },
      durability: {
        persisted: false,
        errorCode: 'auth_store_persistence_failed_after_live_apply',
      },
    });
  });

  it('threads direct-live-required policy into runtime apply requests', async () => {
    const adapter = createCodexConnectedServiceRuntimeAuthAdapter();
    const applyConnectedServiceAuthGeneration = vi.fn(async () => ({
      ok: false,
      errorCode: 'refresh_selection_resync_failed',
      error: 'refresh_selection_resync_failed',
    }));

    await expect(adapter.hotApply({
      target: { agentId: 'codex' },
      selection: {
        serviceId: 'openai-codex',
        record: buildConnectedServiceCredentialRecord({
          now: 1_000,
          serviceId: 'openai-codex',
          profileId: 'work',
          kind: 'oauth',
          expiresAt: 2_000,
          oauth: {
            accessToken: 'access',
            refreshToken: 'refresh',
            idToken: 'id',
            scope: null,
            tokenType: null,
            providerAccountId: 'acct',
            providerEmail: 'codex-user@example.test',
          },
        }),
        applyConnectedServiceAuthGeneration,
        applyReason: 'same_provider_account_exhausted',
        requireDirectLiveHotApply: true,
      },
    })).resolves.toEqual({
      applied: false,
      reason: 'refresh_selection_resync_failed',
      error: 'refresh_selection_resync_failed',
    });

    expect(applyConnectedServiceAuthGeneration).toHaveBeenCalledWith(expect.objectContaining({
      reason: 'same_provider_account_exhausted',
      requireDirectLiveHotApply: true,
    }));
  });

  it('reports direct-live partial mutations as restart-required partial state', async () => {
    const adapter = createCodexConnectedServiceRuntimeAuthAdapter();
    const applyConnectedServiceAuthGeneration = vi.fn(async () => ({
      ok: false,
      errorCode: 'refresh_selection_resync_failed',
      error: 'refresh_selection_resync_failed',
      appliedVia: 'direct_live_hot_auth',
      activeAccountId: 'acct_live',
      recovery: 'restart_resume',
      verification: {
        status: 'verified',
        activeAccountId: 'acct_live',
        proofStrength: 'exact',
      },
    }));

    await expect(adapter.hotApply({
      target: { agentId: 'codex' },
      selection: {
        record: buildConnectedServiceCredentialRecord({
          now: 1_000,
          serviceId: 'openai-codex',
          profileId: 'work',
          kind: 'oauth',
          expiresAt: 2_000,
          oauth: {
            accessToken: 'access',
            refreshToken: 'refresh',
            idToken: 'id',
            scope: null,
            tokenType: null,
            providerAccountId: 'acct_live',
            providerEmail: 'codex-user@example.test',
          },
        }),
        applyConnectedServiceAuthGeneration,
        applyReason: 'same_provider_account_exhausted',
        requireDirectLiveHotApply: true,
      },
    })).resolves.toEqual({
      applied: false,
      appliedVia: 'direct_live_hot_auth',
      activeAccountId: 'acct_live',
      partialState: 'runtime_auth_applied',
      recovery: 'restart_resume',
      reason: 'refresh_selection_resync_failed',
      error: 'refresh_selection_resync_failed',
      verification: {
        status: 'verified',
        activeAccountId: 'acct_live',
        proofStrength: 'exact',
      },
    });
  });

  it('reports restart recovery when direct live runtime apply is unavailable', async () => {
    const adapter = createCodexConnectedServiceRuntimeAuthAdapter();

    await expect(adapter.hotApply({
      target: { agentId: 'codex' },
      selection: {
        record: buildConnectedServiceCredentialRecord({
          now: 1_000,
          serviceId: 'openai-codex',
          profileId: 'work',
          kind: 'oauth',
          expiresAt: 2_000,
          oauth: {
            accessToken: 'access',
            refreshToken: 'refresh',
            idToken: 'id',
            scope: null,
            tokenType: null,
            providerAccountId: 'acct',
            providerEmail: 'codex-user@example.test',
          },
        }),
      },
    })).resolves.toEqual({
      applied: false,
      reason: 'direct_live_hot_auth_unsupported',
      recovery: 'restart_resume',
    });
  });

  it('records account/rateLimits/read probe snapshots with live account/read identity into the runtime quota store for group selections', async () => {
    const store = new ConnectedServiceAuthGroupRuntimeQuotaSnapshotStore();
    const adapter = createCodexConnectedServiceRuntimeAuthAdapter();
    const client = {
      request: vi.fn(async (method: string) => {
        if (method === 'account/read') {
          return {
            account: {
              id: 'acct_live_codex',
              email: 'live-codex-user@example.test',
            },
          };
        }
        return {
          primary: {
            used_percent: 97,
            resets_at: 1_768_100_000_000,
          },
        };
      }),
    };

    const result = await adapter.probeQuota({
      target: { agentId: 'codex' },
      selection: {
        serviceId: 'openai-codex',
        groupId: 'main',
        activeProfileId: 'work',
        client,
        runtimeQuotaSnapshots: store,
        record: buildConnectedServiceCredentialRecord({
          now: 1_000,
          serviceId: 'openai-codex',
          profileId: 'work',
          kind: 'oauth',
          expiresAt: 2_000,
          oauth: {
            accessToken: 'access',
            refreshToken: 'refresh',
            idToken: 'id',
            scope: null,
            tokenType: null,
            providerAccountId: 'acct',
            providerEmail: 'codex-user@example.test',
          },
        }),
      },
    });

    expect(result).toMatchObject({ status: 'available' });
    expect(store.getSnapshot({
      serviceId: 'openai-codex',
      groupId: 'main',
      profileId: 'work',
    })).toMatchObject({
      activeAccountId: 'acct_live_codex',
      accountLabel: 'live-codex-user@example.test',
      meters: [expect.objectContaining({ utilizationPct: 97 })],
    });
  });

  it('adds Codex reset-credit inventory to app-server quota probe snapshots from connected-service OAuth', async () => {
    const store = new ConnectedServiceAuthGroupRuntimeQuotaSnapshotStore();
    const fetchRuntime = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        available_count: 1,
        credits: [
          {
            id: 'credit-1',
            reset_type: 'codex_rate_limits',
            status: 'available',
            expires_at: '2026-07-12T01:51:02.745763Z',
          },
        ],
      }),
    } as Response));
    const adapter = createCodexConnectedServiceRuntimeAuthAdapter({
      fetchRuntime,
      resetCreditsUrl: 'https://chatgpt.example.test/backend-api/wham/rate-limit-reset-credits',
    });
    const client = {
      request: vi.fn(async (method: string) => {
        if (method === 'account/read') {
          return { account: { id: 'acct_live_codex', email: 'live-codex-user@example.test' } };
        }
        return { primary: { used_percent: 97, resets_at: 1_768_100_000_000 } };
      }),
    };

    const result = await adapter.probeQuota({
      target: { agentId: 'codex' },
      selection: {
        serviceId: 'openai-codex',
        groupId: 'main',
        activeProfileId: 'work',
        client,
        runtimeQuotaSnapshots: store,
        record: buildConnectedServiceCredentialRecord({
          now: 1_000,
          serviceId: 'openai-codex',
          profileId: 'work',
          kind: 'oauth',
          expiresAt: 2_000,
          oauth: {
            accessToken: 'access',
            refreshToken: 'refresh',
            idToken: 'id',
            scope: null,
            tokenType: null,
            providerAccountId: 'acct',
            providerEmail: 'codex-user@example.test',
          },
        }),
      },
    });

    expect(result).toMatchObject({
      status: 'available',
      quotaSnapshot: {
        recoveryCredits: {
          availableCount: 1,
          nextExpiresAtMs: Date.parse('2026-07-12T01:51:02.745Z'),
        },
      },
    });
    expect(fetchRuntime).toHaveBeenCalledWith(
      'https://chatgpt.example.test/backend-api/wham/rate-limit-reset-credits',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer access',
          'ChatGPT-Account-Id': 'acct',
        }),
      }),
    );
  });

  it('does not report selected credential account id as activeAccountId when live account proof is unavailable', async () => {
    const store = new ConnectedServiceAuthGroupRuntimeQuotaSnapshotStore();
    const adapter = createCodexConnectedServiceRuntimeAuthAdapter();
    const client = {
      request: vi.fn(async (method: string) => {
        if (method === 'account/read') {
          return { account: { email: 'codex-user@example.test' } };
        }
        return {
          primary: {
            used_percent: 97,
            resets_at: 1_768_100_000_000,
          },
        };
      }),
    };

    const result = await adapter.probeQuota({
      target: { agentId: 'codex' },
      selection: {
        serviceId: 'openai-codex',
        groupId: 'main',
        activeProfileId: 'work',
        client,
        runtimeQuotaSnapshots: store,
        record: buildConnectedServiceCredentialRecord({
          now: 1_000,
          serviceId: 'openai-codex',
          profileId: 'work',
          kind: 'oauth',
          expiresAt: 2_000,
          oauth: {
            accessToken: 'access',
            refreshToken: 'refresh',
            idToken: 'id',
            scope: null,
            tokenType: null,
            providerAccountId: 'acct_selected_not_live',
            providerEmail: 'codex-user@example.test',
          },
        }),
      },
    });

    expect(result).toMatchObject({ status: 'available' });
    expect(store.getSnapshot({
      serviceId: 'openai-codex',
      groupId: 'main',
      profileId: 'work',
    })).toMatchObject({
      accountLabel: 'codex-user@example.test',
      meters: [expect.objectContaining({ utilizationPct: 97 })],
    });
    expect(store.getSnapshot({
      serviceId: 'openai-codex',
      groupId: 'main',
      profileId: 'work',
    })).not.toHaveProperty('activeAccountId');
  });

  it('returns unsupported for non-app-server Codex probes without calling app-server rate-limit APIs', async () => {
    const adapter = createCodexConnectedServiceRuntimeAuthAdapter();
    const client = {
      request: vi.fn(async () => ({ primary: { used_percent: 1 } })),
    };

    await expect(adapter.probeQuota({
      target: { agentId: 'codex' },
      selection: {
        backendMode: 'mcp',
        client,
        record: buildConnectedServiceCredentialRecord({
          now: 1_000,
          serviceId: 'openai-codex',
          profileId: 'work',
          kind: 'oauth',
          expiresAt: 2_000,
          oauth: {
            accessToken: 'access',
            refreshToken: 'refresh',
            idToken: 'id',
            scope: null,
            tokenType: null,
            providerAccountId: 'acct',
            providerEmail: null,
          },
        }),
      },
    })).resolves.toEqual({
      status: 'unsupported',
      reason: 'codex_quota_probe_unsupported_for_backend_mode',
    });
    expect(client.request).not.toHaveBeenCalled();
  });
});
