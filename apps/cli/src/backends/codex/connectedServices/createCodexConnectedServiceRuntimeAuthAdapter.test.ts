import { describe, expect, it, vi } from 'vitest';

import { buildConnectedServiceCredentialRecord } from '@happier-dev/protocol';

import { createCodexConnectedServiceRuntimeAuthAdapter } from './createCodexConnectedServiceRuntimeAuthAdapter';
import { ConnectedServiceAuthGroupRuntimeQuotaSnapshotStore } from '@/daemon/connectedServices/accountGroups/quotas/ConnectedServiceAuthGroupRuntimeQuotaSnapshotStore';

describe('createCodexConnectedServiceRuntimeAuthAdapter', () => {
  it('reports restart recovery when transport invalidation is unavailable for hot apply', () => {
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
      reason: 'transport_invalidation_unavailable',
      recovery: 'restart_resume',
    });
  });

  it('reports restart recovery when hot apply has no active app-server client', async () => {
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
      reason: 'missing_client',
      recovery: 'restart_resume',
    });
  });

  it('records account/rateLimits/read probe snapshots into the runtime quota store for group selections', async () => {
    const store = new ConnectedServiceAuthGroupRuntimeQuotaSnapshotStore();
    const adapter = createCodexConnectedServiceRuntimeAuthAdapter();
    const client = {
      request: vi.fn(async () => ({
        primary: {
          used_percent: 97,
          resets_at: 1_768_100_000_000,
        },
      })),
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
      activeAccountId: 'acct',
      accountLabel: 'codex-user@example.test',
      meters: [expect.objectContaining({ utilizationPct: 97 })],
    });
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
