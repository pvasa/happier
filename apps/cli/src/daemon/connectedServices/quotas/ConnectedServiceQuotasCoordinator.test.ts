import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildConnectedServiceCredentialRecord,
  ConnectedServiceQuotaSnapshotV1Schema,
  openAccountScopedBlobCiphertext,
  sealAccountScopedBlobCiphertext,
} from '@happier-dev/protocol';
import type { ConnectedServiceAuthGroupV1, ConnectedServiceQuotaSnapshotV1 } from '@happier-dev/protocol';
import { randomBytes } from 'node:crypto';

import type { Credentials } from '@/persistence';
import { invalidateConnectedServiceAccountMode } from '@/cloud/connectedServices/resolveConnectedServiceAccountMode';
import { HAPPIER_CONNECTED_SERVICE_SELECTIONS_ENV_KEY } from '../connectedServiceChildEnvironment';
import { ConnectedServiceAuthGroupRuntimeQuotaSnapshotStore } from '../accountGroups/quotas/ConnectedServiceAuthGroupRuntimeQuotaSnapshotStore';
import { CLAUDE_SUBSCRIPTION_OAUTH_SCOPE } from '../descriptors/connectedAccountDescriptors';
import { ConnectedServiceQuotasCoordinator } from './ConnectedServiceQuotasCoordinator';
import { ConnectedServiceQuotaFetchError, type ConnectedServiceQuotaFetcher } from './types';
import { DEFAULT_CONNECTED_SERVICE_AUTH_GROUP_POLICY_V1 } from '../accountGroups/selection/selectConnectedServiceAuthGroupCandidate';

type QuotaApi = ConstructorParameters<typeof ConnectedServiceQuotasCoordinator>[0]['api'];
type RegisterArgs = Parameters<QuotaApi['registerConnectedServiceQuotaSnapshotSealed']>[0];
type RegisterPlainArgs = Parameters<NonNullable<QuotaApi['registerConnectedServiceQuotaSnapshotPlain']>>[0];
type FetchArgs = Parameters<ConnectedServiceQuotaFetcher['fetch']>[0];
type SealedCredentialResponse = NonNullable<Awaited<ReturnType<QuotaApi['getConnectedServiceCredentialSealed']>>>;
type SealedQuotaSnapshotResponse = NonNullable<Awaited<ReturnType<QuotaApi['getConnectedServiceQuotaSnapshotSealed']>>>;

const directLiveExternalTokenInjectionCapability = {
  directLiveHotAuth: {
    supportsInTurnApply: true,
    requiresExactRuntimeIdentity: true,
    refreshSelectionResync: 'required',
    authMode: {
      kind: 'external_token_injection',
      surface: 'codex_chatgpt_auth_tokens',
    },
  },
} as const;

function buildQuotaSnapshotFixture(input: Readonly<{
  serviceId: ConnectedServiceQuotaSnapshotV1['serviceId'];
  profileId: string;
  now: number;
  remainingPct: number;
  resetsAt?: number;
}>): ConnectedServiceQuotaSnapshotV1 {
  return {
    v: 1,
    serviceId: input.serviceId,
    profileId: input.profileId,
    fetchedAt: input.now,
    staleAfterMs: 300_000,
    planLabel: 'Pro',
    accountLabel: `${input.profileId}@example.com`,
    meters: [{
      meterId: 'weekly',
      label: 'Weekly',
      used: null,
      limit: null,
      unit: 'unknown',
      utilizationPct: Math.max(0, Math.min(100, 100 - input.remainingPct)),
      remainingPct: input.remainingPct,
      resetsAt: input.resetsAt ?? input.now + 600_000,
      status: 'ok',
      details: {},
    }],
  };
}

function createSoftSwitchEligibilityFixture(input: Readonly<{
  serviceId: ConnectedServiceQuotaSnapshotV1['serviceId'];
  now: number;
  groupId?: string;
  activeProfileId?: string;
  memberProfileIds?: readonly string[];
  targetProfileIds?: readonly string[];
}>): Readonly<{
  runtimeQuotaSnapshots: ConnectedServiceAuthGroupRuntimeQuotaSnapshotStore;
  getConnectedServiceAuthGroup: QuotaApi['getConnectedServiceAuthGroup'];
}> {
  const groupId = input.groupId ?? 'team';
  const activeProfileId = input.activeProfileId ?? 'active';
  const targetProfileIds = input.targetProfileIds ?? ['backup'];
  const runtimeQuotaSnapshots = new ConnectedServiceAuthGroupRuntimeQuotaSnapshotStore();
  for (const profileId of targetProfileIds) {
    runtimeQuotaSnapshots.recordSnapshot({
      serviceId: input.serviceId,
      groupId,
      profileId,
      snapshot: buildQuotaSnapshotFixture({
        serviceId: input.serviceId,
        profileId,
        now: input.now,
        remainingPct: 90,
      }),
    });
  }
  const profileIds = Array.from(new Set([activeProfileId, ...(input.memberProfileIds ?? []), ...targetProfileIds]));
  const group: ConnectedServiceAuthGroupV1 = {
    v: 1,
    serviceId: input.serviceId,
    groupId,
    displayName: 'Team',
    activeProfileId,
    generation: 1,
    policy: {
      ...DEFAULT_CONNECTED_SERVICE_AUTH_GROUP_POLICY_V1,
      autoSwitch: true,
      strategy: 'least_limited',
      cooldownMs: 500,
      softSwitchRemainingPercent: 15,
    },
    state: { v: 1 },
    members: profileIds.map((profileId, index) => ({
      v: 1 as const,
      serviceId: input.serviceId,
      groupId,
      profileId,
      priority: index,
      enabled: true,
      state: {},
      createdAt: index + 1,
      updatedAt: index + 1,
    })),
    createdAt: 1,
    updatedAt: 2,
  };
  return {
    runtimeQuotaSnapshots,
    getConnectedServiceAuthGroup: vi.fn(async () => group),
  };
}

function createDeferred<T>(): Readonly<{
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

describe('ConnectedServiceQuotasCoordinator', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    invalidateConnectedServiceAccountMode();
  });

  it('skips quota bridge fetches for known reconnect-required profiles', async () => {
    let now = 1_000_000;

    const credentials: Credentials = {
      token: 'happy-token',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(9) },
    };

    const api = {
      getAccountEncryptionMode: vi.fn(async () => 'plain' as const),
      listConnectedServiceProfiles: vi.fn(async () => ({
        serviceId: 'openai-codex' as const,
        profiles: [{ profileId: 'work', status: 'needs_reauth' as const }],
      })),
      getConnectedServiceQuotaSnapshotPlain: vi.fn(async () => null),
      getConnectedServiceCredentialPlain: vi.fn(async () => {
        throw new Error('Reconnect-required profile should not read credentials for quota fetch');
      }),
      registerConnectedServiceQuotaSnapshotPlain: vi.fn(async () => {}),
      getConnectedServiceQuotaSnapshotSealed: vi.fn(async () => null),
      getConnectedServiceCredentialSealed: vi.fn(async () => null),
      registerConnectedServiceQuotaSnapshotSealed: vi.fn(async () => {}),
    } as unknown as QuotaApi;

    const fetcher: ConnectedServiceQuotaFetcher = {
      serviceId: 'openai-codex',
      fetch: vi.fn(async (): Promise<ConnectedServiceQuotaSnapshotV1 | null> => ({
        v: 1,
        serviceId: 'openai-codex',
        profileId: 'work',
        fetchedAt: now,
        staleAfterMs: 300_000,
        planLabel: null,
        accountLabel: null,
        meters: [],
      })),
    };

    const coordinator = new ConnectedServiceQuotasCoordinator({
      api,
      credentials,
      quotaFetchers: [fetcher],
      now: () => now,
      randomBytes: (length: number) => randomBytes(length),
    });
    coordinator.registerSpawnTarget({
      pid: 123,
      connectedServicesBindingsRaw: {
        v: 1,
        bindingsByServiceId: { 'openai-codex': { source: 'connected', profileId: 'work' } },
      },
    });

    await coordinator.tickOnce();

    expect(api.listConnectedServiceProfiles).toHaveBeenCalledWith({ serviceId: 'openai-codex' });
    expect(api.getConnectedServiceCredentialPlain).not.toHaveBeenCalled();
    expect(fetcher.fetch).not.toHaveBeenCalled();
  });

  it('fetches and uploads plaintext quota snapshots for plaintext accounts', async () => {
    let now = 1_000_000;

    const credentials: Credentials = {
      token: 'happy-token',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(9) },
    };
    if (credentials.encryption.type !== 'legacy') throw new Error('fixture');

    const record = buildConnectedServiceCredentialRecord({
      now,
      serviceId: 'openai-codex',
      profileId: 'work',
      kind: 'oauth',
      expiresAt: now + 60_000,
      oauth: {
        accessToken: 'access',
        refreshToken: 'refresh',
        idToken: null,
        scope: null,
        tokenType: null,
        providerAccountId: 'acct',
        providerEmail: 'user@example.com',
      },
    });

    const api = {
      getAccountEncryptionMode: vi.fn(async () => 'plain' as const),
      getConnectedServiceQuotaSnapshotPlain: vi.fn(async () => null),
      getConnectedServiceCredentialPlain: vi.fn(async () => ({ content: { t: 'plain' as const, v: record } })),
      registerConnectedServiceQuotaSnapshotPlain: vi.fn(async () => {}),
      getConnectedServiceQuotaSnapshotSealed: vi.fn(async () => null),
      getConnectedServiceCredentialSealed: vi.fn(async () => null),
      registerConnectedServiceQuotaSnapshotSealed: vi.fn(async () => {}),
    } as unknown as QuotaApi;

    const fetcher: ConnectedServiceQuotaFetcher = {
      serviceId: 'openai-codex',
      fetch: vi.fn(async ({ record: inputRecord }: FetchArgs): Promise<ConnectedServiceQuotaSnapshotV1 | null> => ({
        v: 1,
        serviceId: inputRecord.serviceId,
        profileId: inputRecord.profileId,
        fetchedAt: now,
        staleAfterMs: 300_000,
        planLabel: 'Pro',
        accountLabel: 'user@example.com',
        meters: [],
      })),
    };

    const coordinator = new ConnectedServiceQuotasCoordinator({
      api,
      credentials,
      quotaFetchers: [fetcher],
      now: () => now,
      randomBytes: (length: number) => randomBytes(length),
    });

    coordinator.registerSpawnTarget({
      pid: 123,
      connectedServicesBindingsRaw: {
        v: 1,
        bindingsByServiceId: { 'openai-codex': { source: 'connected', profileId: 'work' } },
      },
    });

    await coordinator.tickOnce();

    expect((api as any).getAccountEncryptionMode).toHaveBeenCalled();
    expect((api as any).getConnectedServiceCredentialPlain).toHaveBeenCalledWith({ serviceId: 'openai-codex', profileId: 'work' });
    expect((api as any).registerConnectedServiceQuotaSnapshotPlain).toHaveBeenCalledTimes(1);
    expect((api as any).registerConnectedServiceQuotaSnapshotSealed).toHaveBeenCalledTimes(0);
  });

  it('consumes recovery credits through the quota fetcher and persists a refreshed plaintext snapshot', async () => {
    let now = 1_000_000;

    const credentials: Credentials = {
      token: 'happy-token',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(9) },
    };
    const record = buildConnectedServiceCredentialRecord({
      now,
      serviceId: 'openai-codex',
      profileId: 'work',
      kind: 'oauth',
      expiresAt: now + 60_000,
      oauth: {
        accessToken: 'access',
        refreshToken: 'refresh',
        idToken: null,
        scope: null,
        tokenType: null,
        providerAccountId: 'acct',
        providerEmail: 'user@example.com',
      },
    });

    const api = {
      getAccountEncryptionMode: vi.fn(async () => 'plain' as const),
      getConnectedServiceQuotaSnapshotPlain: vi.fn(async () => null),
      getConnectedServiceCredentialPlain: vi.fn(async () => ({ content: { t: 'plain' as const, v: record } })),
      registerConnectedServiceQuotaSnapshotPlain: vi.fn(async () => {}),
      getConnectedServiceQuotaSnapshotSealed: vi.fn(async () => null),
      getConnectedServiceCredentialSealed: vi.fn(async () => null),
      registerConnectedServiceQuotaSnapshotSealed: vi.fn(async () => {}),
    } as unknown as QuotaApi;

    const fetcher: ConnectedServiceQuotaFetcher = {
      serviceId: 'openai-codex',
      consumeRecoveryCredit: vi.fn(async ({ record: inputRecord }) => ({
        ok: true,
        serviceId: inputRecord.serviceId,
        profileId: inputRecord.profileId,
      })),
      fetch: vi.fn(async ({ record: inputRecord }: FetchArgs): Promise<ConnectedServiceQuotaSnapshotV1 | null> => ({
        v: 1,
        serviceId: inputRecord.serviceId,
        profileId: inputRecord.profileId,
        fetchedAt: now,
        staleAfterMs: 300_000,
        planLabel: 'Pro',
        accountLabel: 'user@example.com',
        recoveryCredits: {
          kind: 'usage_limit_resets',
          availableCount: 0,
          totalCount: 1,
          source: 'provider_api',
          confidence: 'exact',
          credits: [],
        },
        meters: [],
      })),
    };

    const coordinator = new ConnectedServiceQuotasCoordinator({
      api,
      credentials,
      quotaFetchers: [fetcher],
      now: () => now,
      randomBytes: (length: number) => randomBytes(length),
    });

    const result = await coordinator.consumeRecoveryCreditForProfile({
      serviceId: 'openai-codex',
      profileId: 'work',
      idempotencyKey: 'reset-req-1',
      providerCreditId: 'credit-1',
    });

    expect(result).toEqual(expect.objectContaining({
      ok: true,
      receipt: {
        idempotencyKey: 'reset-req-1',
        providerCreditId: 'credit-1',
        status: 'consumed',
      },
    }));
    expect(fetcher.consumeRecoveryCredit).toHaveBeenCalledWith(expect.objectContaining({
      record,
      now,
      idempotencyKey: 'reset-req-1',
      providerCreditId: 'credit-1',
    }));
    expect(fetcher.fetch).toHaveBeenCalledTimes(1);
    expect((api as any).registerConnectedServiceQuotaSnapshotPlain).toHaveBeenCalledWith(expect.objectContaining({
      serviceId: 'openai-codex',
      profileId: 'work',
      content: expect.objectContaining({
        t: 'plain',
        v: expect.objectContaining({
          recoveryCredits: expect.objectContaining({ availableCount: 0 }),
        }),
      }),
    }));
  });

  it('returns the same unknown timeout receipt without a second provider consume for the same idempotency key', async () => {
    vi.useFakeTimers();
    const now = 1_000_000;

    const credentials: Credentials = {
      token: 'happy-token',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(9) },
    };
    const record = buildConnectedServiceCredentialRecord({
      now,
      serviceId: 'openai-codex',
      profileId: 'work',
      kind: 'oauth',
      expiresAt: now + 60_000,
      oauth: {
        accessToken: 'access',
        refreshToken: 'refresh',
        idToken: null,
        scope: null,
        tokenType: null,
        providerAccountId: 'acct',
        providerEmail: 'user@example.com',
      },
    });
    const api = {
      getAccountEncryptionMode: vi.fn(async () => 'plain' as const),
      getConnectedServiceQuotaSnapshotPlain: vi.fn(async () => null),
      getConnectedServiceCredentialPlain: vi.fn(async () => ({ content: { t: 'plain' as const, v: record } })),
      registerConnectedServiceQuotaSnapshotPlain: vi.fn(async () => {}),
      getConnectedServiceQuotaSnapshotSealed: vi.fn(async () => null),
      getConnectedServiceCredentialSealed: vi.fn(async () => null),
      registerConnectedServiceQuotaSnapshotSealed: vi.fn(async () => {}),
    } as unknown as QuotaApi;
    const fetcher: ConnectedServiceQuotaFetcher = {
      serviceId: 'openai-codex',
      consumeRecoveryCredit: vi.fn(async () => await new Promise(() => {})),
      fetch: vi.fn(async () => null),
    };
    const coordinator = new ConnectedServiceQuotasCoordinator({
      api,
      credentials,
      quotaFetchers: [fetcher],
      now: () => now,
      randomBytes: (length: number) => randomBytes(length),
      fetchTimeoutMs: 5,
    });

    const first = coordinator.consumeRecoveryCreditForProfile({
      serviceId: 'openai-codex',
      profileId: 'work',
      idempotencyKey: 'reset-req-timeout',
      providerCreditId: 'credit-1',
    });
    await vi.advanceTimersByTimeAsync(5);

    await expect(first).resolves.toEqual({
      ok: false,
      errorCode: 'connected_service_quota_recovery_credit_timeout',
      error: 'connected_service_quota_recovery_credit_timeout',
      receipt: {
        idempotencyKey: 'reset-req-timeout',
        providerCreditId: 'credit-1',
        status: 'unknown_after_timeout',
      },
    });

    await expect(coordinator.consumeRecoveryCreditForProfile({
      serviceId: 'openai-codex',
      profileId: 'work',
      idempotencyKey: 'reset-req-timeout',
      providerCreditId: 'credit-1',
    })).resolves.toEqual({
      ok: false,
      errorCode: 'connected_service_quota_recovery_credit_timeout',
      error: 'connected_service_quota_recovery_credit_timeout',
      receipt: {
        idempotencyKey: 'reset-req-timeout',
        providerCreditId: 'credit-1',
        status: 'unknown_after_timeout',
      },
    });
    expect(fetcher.consumeRecoveryCredit).toHaveBeenCalledTimes(1);
    expect(fetcher.fetch).not.toHaveBeenCalled();
  });

  it('keeps stale useful quota data when a disabled fetcher returns quota_unknown', async () => {
    const now = 1_000_000;

    const credentials: Credentials = {
      token: 'happy-token',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(9) },
    };
    const record = buildConnectedServiceCredentialRecord({
      now,
      serviceId: 'claude-subscription',
      profileId: 'work',
      kind: 'oauth',
      expiresAt: now + 60_000,
      oauth: {
        accessToken: 'access',
        refreshToken: 'refresh',
        idToken: null,
        scope: CLAUDE_SUBSCRIPTION_OAUTH_SCOPE,
        tokenType: null,
        providerAccountId: 'acct',
        providerEmail: 'user@example.com',
      },
    });
    const staleUsefulSnapshot: ConnectedServiceQuotaSnapshotV1 = {
      v: 1,
      serviceId: 'claude-subscription',
      profileId: 'work',
      fetchedAt: now - 600_000,
      staleAfterMs: 1_000,
      planLabel: 'Max',
      accountLabel: 'user@example.com',
      meters: [
        {
          meterId: 'five_hour',
          label: '5-hour',
          used: null,
          limit: null,
          unit: 'unknown',
          utilizationPct: 80,
          resetsAt: now + 120_000,
          status: 'ok',
          details: {},
        },
      ],
    };
    const disabledUnknownSnapshot: ConnectedServiceQuotaSnapshotV1 = {
      ...staleUsefulSnapshot,
      fetchedAt: now,
      planLabel: null,
      meters: [
        {
          meterId: 'five_hour',
          label: '5-hour',
          used: null,
          limit: null,
          unit: 'unknown',
          utilizationPct: null,
          resetsAt: null,
          status: 'unavailable',
          details: { code: 'quota_unknown' },
        },
      ],
    };
    const api = {
      getAccountEncryptionMode: vi.fn(async () => 'plain' as const),
      getConnectedServiceQuotaSnapshotPlain: vi.fn(async () => ({
        content: { t: 'plain' as const, v: staleUsefulSnapshot },
        metadata: {
          fetchedAt: staleUsefulSnapshot.fetchedAt,
          staleAfterMs: staleUsefulSnapshot.staleAfterMs,
          status: 'ok' as const,
        },
      })),
      getConnectedServiceCredentialPlain: vi.fn(async () => ({ content: { t: 'plain' as const, v: record } })),
      registerConnectedServiceQuotaSnapshotPlain: vi.fn(async () => {}),
      getConnectedServiceQuotaSnapshotSealed: vi.fn(async () => null),
      getConnectedServiceCredentialSealed: vi.fn(async () => null),
      registerConnectedServiceQuotaSnapshotSealed: vi.fn(async () => {}),
    } as unknown as QuotaApi;
    const fetcher: ConnectedServiceQuotaFetcher = {
      serviceId: 'claude-subscription',
      fetch: vi.fn(async () => disabledUnknownSnapshot),
    };
    const runtimeQuotaSnapshots = new ConnectedServiceAuthGroupRuntimeQuotaSnapshotStore();
    const coordinator = new ConnectedServiceQuotasCoordinator({
      api,
      credentials,
      quotaFetchers: [fetcher],
      runtimeQuotaSnapshots,
      now: () => now,
      randomBytes: (length: number) => randomBytes(length),
    });

    coordinator.registerSpawnTarget({
      pid: 123,
      connectedServicesBindingsRaw: {
        v: 1,
        bindingsByServiceId: { 'claude-subscription': { source: 'connected', profileId: 'work' } },
      },
    });

    await coordinator.tickOnce();

    expect(fetcher.fetch).toHaveBeenCalledTimes(1);
    expect((api as any).registerConnectedServiceQuotaSnapshotPlain).not.toHaveBeenCalled();
    const runtimeSnapshot = runtimeQuotaSnapshots.getSnapshot({
      serviceId: 'claude-subscription',
      groupId: 'work-group',
      profileId: 'work',
    });
    expect(runtimeSnapshot?.accountLabel).toBe('user@example.com');
    expect(runtimeSnapshot?.meters[0]?.utilizationPct).toBe(80);
    expect(runtimeSnapshot?.meters[0]?.details?.code).toBe('stale_quota');
  });

  it('routes polling quota snapshot writes through daemon server work', async () => {
    let now = 1_000_000;

    const credentials: Credentials = {
      token: 'happy-token',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(9) },
    };
    const record = buildConnectedServiceCredentialRecord({
      now,
      serviceId: 'openai-codex',
      profileId: 'work',
      kind: 'oauth',
      expiresAt: now + 60_000,
      oauth: {
        accessToken: 'access',
        refreshToken: 'refresh',
        idToken: null,
        scope: null,
        tokenType: null,
        providerAccountId: 'acct',
        providerEmail: 'user@example.com',
      },
    });
    const api = {
      getAccountEncryptionMode: vi.fn(async () => 'plain' as const),
      getConnectedServiceQuotaSnapshotPlain: vi.fn(async () => null),
      getConnectedServiceCredentialPlain: vi.fn(async () => ({ content: { t: 'plain' as const, v: record } })),
      registerConnectedServiceQuotaSnapshotPlain: vi.fn(async () => {}),
      getConnectedServiceQuotaSnapshotSealed: vi.fn(async () => null),
      getConnectedServiceCredentialSealed: vi.fn(async () => null),
      registerConnectedServiceQuotaSnapshotSealed: vi.fn(async () => {}),
    } as unknown as QuotaApi;
    const serverWorkScheduler = {
      enqueue: vi.fn(async (request) => {
        await request.run(request.payload);
        return { status: 'written' as const };
      }),
      flushAll: vi.fn(async () => ({ timedOut: false })),
      recordEvent: vi.fn(),
      getSnapshot: vi.fn(() => ({
        pendingKeyCount: 0,
        pendingPayloadBytes: 0,
        purposes: {},
        keys: {},
      })),
    } satisfies NonNullable<ConstructorParameters<typeof ConnectedServiceQuotasCoordinator>[0]['quotaPersistenceServerWorkScheduler']>;
    const fetcher: ConnectedServiceQuotaFetcher = {
      serviceId: 'openai-codex',
      fetch: vi.fn(async ({ record: inputRecord }: FetchArgs): Promise<ConnectedServiceQuotaSnapshotV1 | null> => ({
        v: 1,
        serviceId: inputRecord.serviceId,
        profileId: inputRecord.profileId,
        fetchedAt: now,
        staleAfterMs: 300_000,
        planLabel: 'Pro',
        accountLabel: 'user@example.com',
        meters: [],
      })),
    };
    const coordinator = new ConnectedServiceQuotasCoordinator({
      api,
      credentials,
      quotaFetchers: [fetcher],
      now: () => now,
      randomBytes: (length: number) => randomBytes(length),
      quotaPersistenceServerWorkScheduler: serverWorkScheduler,
    });

    coordinator.registerSpawnTarget({
      pid: 123,
      connectedServicesBindingsRaw: {
        v: 1,
        bindingsByServiceId: { 'openai-codex': { source: 'connected', profileId: 'work' } },
      },
    });

    await coordinator.tickOnce();

    expect(serverWorkScheduler.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      purpose: 'connectedServiceQuotaPersistence',
      kind: 'latestStateWrite',
      key: expect.stringContaining('openai-codex'),
    }));
    expect((api as any).registerConnectedServiceQuotaSnapshotPlain).toHaveBeenCalledTimes(1);
  });

  it('defers polling quota work when the account-mode probe errors', async () => {
    const now = 1_000_000;

    const credentials: Credentials = {
      token: 'happy-token',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(9) },
    };
    if (credentials.encryption.type !== 'legacy') throw new Error('fixture');

    const record = buildConnectedServiceCredentialRecord({
      now,
      serviceId: 'openai-codex',
      profileId: 'work',
      kind: 'oauth',
      expiresAt: now + 60_000,
      oauth: {
        accessToken: 'access',
        refreshToken: 'refresh',
        idToken: null,
        scope: null,
        tokenType: null,
        providerAccountId: 'acct',
        providerEmail: 'user@example.com',
      },
    });

    const api = {
      getAccountEncryptionMode: vi.fn(async () => {
        throw new Error('mode probe failed');
      }),
      getConnectedServiceQuotaSnapshotPlain: vi.fn(async () => null),
      getConnectedServiceCredentialPlain: vi.fn(async () => ({ content: { t: 'plain' as const, v: record } })),
      registerConnectedServiceQuotaSnapshotPlain: vi.fn(async () => {}),
      getConnectedServiceQuotaSnapshotSealed: vi.fn(async () => null),
      getConnectedServiceCredentialSealed: vi.fn(async () => null),
      registerConnectedServiceQuotaSnapshotSealed: vi.fn(async () => {}),
    } as unknown as QuotaApi;

    const fetcher: ConnectedServiceQuotaFetcher = {
      serviceId: 'openai-codex',
      fetch: vi.fn(async ({ record: inputRecord }: FetchArgs): Promise<ConnectedServiceQuotaSnapshotV1 | null> => ({
        v: 1,
        serviceId: inputRecord.serviceId,
        profileId: inputRecord.profileId,
        fetchedAt: now,
        staleAfterMs: 300_000,
        planLabel: 'Pro',
        accountLabel: 'user@example.com',
        meters: [],
      })),
    };

    const coordinator = new ConnectedServiceQuotasCoordinator({
      api,
      credentials,
      quotaFetchers: [fetcher],
      now: () => now,
      randomBytes: (length: number) => randomBytes(length),
    });

    coordinator.registerSpawnTarget({
      pid: 123,
      connectedServicesBindingsRaw: {
        v: 1,
        bindingsByServiceId: { 'openai-codex': { source: 'connected', profileId: 'work' } },
      },
    });

    await coordinator.tickOnce();

    expect((api as any).getAccountEncryptionMode).toHaveBeenCalled();
    expect((api as any).getConnectedServiceQuotaSnapshotPlain).not.toHaveBeenCalled();
    expect((api as any).getConnectedServiceQuotaSnapshotSealed).not.toHaveBeenCalled();
    expect((api as any).getConnectedServiceCredentialPlain).not.toHaveBeenCalled();
    expect((api as any).getConnectedServiceCredentialSealed).not.toHaveBeenCalled();
    expect(fetcher.fetch).not.toHaveBeenCalled();
    expect((api as any).registerConnectedServiceQuotaSnapshotPlain).not.toHaveBeenCalled();
    expect((api as any).registerConnectedServiceQuotaSnapshotSealed).toHaveBeenCalledTimes(0);
  });

  it('fetches and uploads sealed quota snapshots for active bindings', async () => {
    const now = 1_000_000;

    const credentials: Credentials = {
      token: 'happy-token',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(9) },
    };
    if (credentials.encryption.type !== 'legacy') throw new Error('fixture');

    const record = buildConnectedServiceCredentialRecord({
      now,
      serviceId: 'openai-codex',
      profileId: 'work',
      kind: 'oauth',
      expiresAt: now + 60_000,
      oauth: {
        accessToken: 'access',
        refreshToken: 'refresh',
        idToken: null,
        scope: null,
        tokenType: null,
        providerAccountId: 'acct',
        providerEmail: 'user@example.com',
      },
    });

    const sealedCredentialCiphertext = sealAccountScopedBlobCiphertext({
      kind: 'connected_service_credential',
      material: { type: 'legacy', secret: credentials.encryption.secret },
      payload: record,
      randomBytes: (length) => randomBytes(length),
    });
    const sealedCredential: SealedCredentialResponse = {
      sealed: { format: 'account_scoped_v1', ciphertext: sealedCredentialCiphertext },
      metadata: { kind: 'oauth' },
    };

    let uploadedCiphertext: string | null = null;
    let uploadedStatus: string | null = null;
    const api = {
      getConnectedServiceQuotaSnapshotSealed: vi.fn(async () => null),
      getConnectedServiceCredentialSealed: vi.fn(async (): Promise<SealedCredentialResponse | null> => sealedCredential),
      registerConnectedServiceQuotaSnapshotSealed: vi.fn(async (params: RegisterArgs) => {
        uploadedCiphertext = params.sealed.ciphertext;
        uploadedStatus = params.metadata?.status ?? null;
      }),
    } satisfies QuotaApi;

    const fetcher: ConnectedServiceQuotaFetcher = {
      serviceId: 'openai-codex',
      fetch: vi.fn(async ({ record: inputRecord }: FetchArgs): Promise<ConnectedServiceQuotaSnapshotV1 | null> => ({
        v: 1,
        serviceId: inputRecord.serviceId,
        profileId: inputRecord.profileId,
        fetchedAt: now,
        staleAfterMs: 300_000,
        planLabel: 'Pro',
        accountLabel: 'user@example.com',
        meters: [
          {
            meterId: 'weekly',
            label: 'Weekly',
            used: 1,
            limit: 10,
            unit: 'count',
            utilizationPct: 10,
            resetsAt: now + 60_000,
            status: 'ok',
            details: {},
          },
        ],
      })),
    };

    const coordinator = new ConnectedServiceQuotasCoordinator({
      api,
      credentials,
      quotaFetchers: [fetcher],
      now: () => now,
      randomBytes: (length: number) => randomBytes(length),
    });

    coordinator.registerSpawnTarget({
      pid: 123,
      connectedServicesBindingsRaw: {
        v: 1,
        bindingsByServiceId: { 'openai-codex': { source: 'connected', profileId: 'work' } },
      },
    });

    await coordinator.tickOnce();

    expect(fetcher.fetch).toHaveBeenCalledTimes(1);
    expect(api.registerConnectedServiceQuotaSnapshotSealed).toHaveBeenCalledTimes(1);
    expect(typeof uploadedCiphertext).toBe('string');
    expect(uploadedStatus).toBe('ok');

    const opened = openAccountScopedBlobCiphertext({
      kind: 'connected_service_quota_snapshot',
      material: { type: 'legacy', secret: credentials.encryption.secret },
      ciphertext: uploadedCiphertext ?? '',
    });
    expect(opened?.value).toBeTruthy();
    const parsed = ConnectedServiceQuotaSnapshotV1Schema.safeParse(opened?.value);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.serviceId).toBe('openai-codex');
      expect(parsed.data.profileId).toBe('work');
    }
  });

  it('uses resolved group active profiles from child selections when registering spawn targets', async () => {
    const now = 1_000_000;

    const credentials: Credentials = {
      token: 'happy-token',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(9) },
    };
    if (credentials.encryption.type !== 'legacy') throw new Error('fixture');

    const record = buildConnectedServiceCredentialRecord({
      now,
      serviceId: 'openai-codex',
      profileId: 'work',
      kind: 'oauth',
      expiresAt: now + 60_000,
      oauth: {
        accessToken: 'access',
        refreshToken: 'refresh',
        idToken: null,
        scope: null,
        tokenType: null,
        providerAccountId: 'acct',
        providerEmail: 'user@example.com',
      },
    });

    const sealedCredentialCiphertext = sealAccountScopedBlobCiphertext({
      kind: 'connected_service_credential',
      material: { type: 'legacy', secret: credentials.encryption.secret },
      payload: record,
      randomBytes: (length) => randomBytes(length),
    });
    const sealedCredential: SealedCredentialResponse = {
      sealed: { format: 'account_scoped_v1', ciphertext: sealedCredentialCiphertext },
      metadata: { kind: 'oauth' },
    };

    const api = {
      getConnectedServiceQuotaSnapshotSealed: vi.fn(async () => null),
      getConnectedServiceCredentialSealed: vi.fn(async (): Promise<SealedCredentialResponse | null> => sealedCredential),
      registerConnectedServiceQuotaSnapshotSealed: vi.fn(async () => {}),
    } satisfies QuotaApi;

    const fetcher: ConnectedServiceQuotaFetcher = {
      serviceId: 'openai-codex',
      fetch: vi.fn(async ({ record: inputRecord }: FetchArgs): Promise<ConnectedServiceQuotaSnapshotV1 | null> => ({
        v: 1,
        serviceId: inputRecord.serviceId,
        profileId: inputRecord.profileId,
        fetchedAt: now,
        staleAfterMs: 300_000,
        planLabel: 'Pro',
        accountLabel: 'user@example.com',
        meters: [],
      })),
    };

    const coordinator = new ConnectedServiceQuotasCoordinator({
      api,
      credentials,
      quotaFetchers: [fetcher],
      now: () => now,
      randomBytes: (length: number) => randomBytes(length),
      discoveryEnabled: false,
    });

    coordinator.registerSpawnTarget({
      pid: 123,
      connectedServicesBindingsRaw: {
        v: 1,
        bindingsByServiceId: {
          'openai-codex': {
            source: 'connected',
            selection: 'group',
            groupId: 'team',
          },
        },
      },
      connectedServiceSelectionsEnv: {
        [HAPPIER_CONNECTED_SERVICE_SELECTIONS_ENV_KEY]: JSON.stringify([{
          kind: 'group',
          serviceId: 'openai-codex',
          groupId: 'team',
          activeProfileId: 'work',
          fallbackProfileId: 'fallback',
          generation: 7,
        }]),
      },
    });

    await coordinator.tickOnce();

    expect(fetcher.fetch).toHaveBeenCalledTimes(1);
    expect(fetcher.fetch).toHaveBeenCalledWith(expect.objectContaining({
      record: expect.objectContaining({
        serviceId: 'openai-codex',
        profileId: 'work',
      }),
    }));
  });

  it('prefers the active group selection over the fallback binding profile after switches', async () => {
    const now = 1_000_000;

    const credentials: Credentials = {
      token: 'happy-token',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(9) },
    };
    if (credentials.encryption.type !== 'legacy') throw new Error('fixture');

    const activeRecord = buildConnectedServiceCredentialRecord({
      now,
      serviceId: 'openai-codex',
      profileId: 'live',
      kind: 'oauth',
      expiresAt: now + 60_000,
      oauth: {
        accessToken: 'access',
        refreshToken: 'refresh',
        idToken: null,
        scope: null,
        tokenType: null,
        providerAccountId: 'acct',
        providerEmail: 'user@example.com',
      },
    });

    const activeCiphertext = sealAccountScopedBlobCiphertext({
      kind: 'connected_service_credential',
      material: { type: 'legacy', secret: credentials.encryption.secret },
      payload: activeRecord,
      randomBytes: (length) => randomBytes(length),
    });

    const api = {
      getConnectedServiceQuotaSnapshotSealed: vi.fn(async () => null),
      getConnectedServiceCredentialSealed: vi.fn(async ({ profileId }: { profileId: string }) => profileId === 'live'
        ? {
            sealed: { format: 'account_scoped_v1' as const, ciphertext: activeCiphertext },
            metadata: { kind: 'oauth' as const },
          }
        : null),
      registerConnectedServiceQuotaSnapshotSealed: vi.fn(async () => {}),
    } satisfies QuotaApi;

    const fetcher: ConnectedServiceQuotaFetcher = {
      serviceId: 'openai-codex',
      fetch: vi.fn(async ({ record: inputRecord }: FetchArgs): Promise<ConnectedServiceQuotaSnapshotV1 | null> => ({
        v: 1,
        serviceId: inputRecord.serviceId,
        profileId: inputRecord.profileId,
        fetchedAt: now,
        staleAfterMs: 300_000,
        planLabel: 'Pro',
        accountLabel: 'user@example.com',
        meters: [],
      })),
    };

    const coordinator = new ConnectedServiceQuotasCoordinator({
      api,
      credentials,
      quotaFetchers: [fetcher],
      now: () => now,
      randomBytes: (length: number) => randomBytes(length),
      discoveryEnabled: false,
    });

    coordinator.registerSpawnTarget({
      pid: 123,
      connectedServicesBindingsRaw: {
        v: 1,
        bindingsByServiceId: {
          'openai-codex': {
            source: 'connected',
            selection: 'group',
            groupId: 'team',
            profileId: 'fallback',
          },
        },
      },
      connectedServiceSelectionsEnv: {
        [HAPPIER_CONNECTED_SERVICE_SELECTIONS_ENV_KEY]: JSON.stringify([{
          kind: 'group',
          serviceId: 'openai-codex',
          groupId: 'team',
          activeProfileId: 'live',
          fallbackProfileId: 'fallback',
          generation: 8,
        }]),
      },
    });

    await coordinator.tickOnce();

    expect(api.getConnectedServiceCredentialSealed).toHaveBeenCalledWith({
      serviceId: 'openai-codex',
      profileId: 'live',
    });
    expect(fetcher.fetch).toHaveBeenCalledWith(expect.objectContaining({
      record: expect.objectContaining({
        serviceId: 'openai-codex',
        profileId: 'live',
      }),
    }));
  });

  it('asks the auth-group switch coordinator to re-evaluate an active group after refreshing its active profile quota', async () => {
    const now = 1_000_000;

    const credentials: Credentials = {
      token: 'happy-token',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(9) },
    };

    const activeRecord = buildConnectedServiceCredentialRecord({
      now,
      serviceId: 'openai-codex',
      profileId: 'active',
      kind: 'oauth',
      expiresAt: now + 60_000,
      oauth: {
        accessToken: 'access',
        refreshToken: 'refresh',
        idToken: null,
        scope: null,
        tokenType: null,
        providerAccountId: 'acct',
        providerEmail: 'user@example.com',
      },
    });
    const softSwitchEligibility = createSoftSwitchEligibilityFixture({
      serviceId: 'openai-codex',
      now,
    });

    const api = {
      getAccountEncryptionMode: vi.fn(async () => 'plain' as const),
      getConnectedServiceQuotaSnapshotPlain: vi.fn(async () => null),
      getConnectedServiceCredentialPlain: vi.fn(async () => ({ content: { t: 'plain' as const, v: activeRecord } })),
      registerConnectedServiceQuotaSnapshotPlain: vi.fn(async () => {}),
      getConnectedServiceQuotaSnapshotSealed: vi.fn(async () => null),
      getConnectedServiceCredentialSealed: vi.fn(async () => null),
      registerConnectedServiceQuotaSnapshotSealed: vi.fn(async () => {}),
      getConnectedServiceAuthGroup: softSwitchEligibility.getConnectedServiceAuthGroup,
    } as unknown as QuotaApi;

    const fetcher: ConnectedServiceQuotaFetcher = {
      serviceId: 'openai-codex',
      fetch: vi.fn(async ({ record: inputRecord }: FetchArgs): Promise<ConnectedServiceQuotaSnapshotV1 | null> => ({
        v: 1,
        serviceId: inputRecord.serviceId,
        profileId: inputRecord.profileId,
        fetchedAt: now,
        staleAfterMs: 300_000,
        planLabel: 'Pro',
        accountLabel: 'user@example.com',
        meters: [
          {
            meterId: 'weekly',
            label: 'Weekly',
            used: null,
            limit: null,
            unit: 'unknown',
            utilizationPct: 95,
            remainingPct: 5,
            resetsAt: now + 60_000,
            status: 'ok',
            details: {},
          },
        ],
      })),
    };
    const switchBeforeTurn = vi.fn(async () => ({ status: 'switched' as const, activeProfileId: 'backup', generation: 2 }));
    const diagnostics: unknown[] = [];
    const coordinatorParams = {
      api,
      credentials,
      quotaFetchers: [fetcher],
      now: () => now,
      randomBytes: (length: number) => randomBytes(length),
      discoveryEnabled: false,
      runtimeQuotaSnapshots: softSwitchEligibility.runtimeQuotaSnapshots,
      authGroupSwitchCoordinator: { switchBeforeTurn },
      groupSwitchCheckMinIntervalMs: 0,
      recordDiagnostic: (event: unknown) => diagnostics.push(event),
    } satisfies ConstructorParameters<typeof ConnectedServiceQuotasCoordinator>[0] & {
      authGroupSwitchCoordinator: { switchBeforeTurn: typeof switchBeforeTurn };
      groupSwitchCheckMinIntervalMs: number;
    };
    const coordinator = new ConnectedServiceQuotasCoordinator(coordinatorParams);

    coordinator.registerSpawnTarget({
      pid: 123,
      sessionId: 'session-1',
      connectedServicesBindingsRaw: {
        v: 1,
        bindingsByServiceId: {
          'openai-codex': {
            source: 'connected',
            selection: 'group',
            groupId: 'team',
          },
        },
      },
      connectedServiceSelectionsEnv: {
        [HAPPIER_CONNECTED_SERVICE_SELECTIONS_ENV_KEY]: JSON.stringify([{
          kind: 'group',
          serviceId: 'openai-codex',
          groupId: 'team',
          activeProfileId: 'active',
          fallbackProfileId: 'backup',
          generation: 1,
        }]),
      },
    });

    await coordinator.tickOnce();

    expect(switchBeforeTurn).toHaveBeenCalledTimes(1);
    expect(switchBeforeTurn).toHaveBeenCalledWith({
      sessionId: 'session-1',
      serviceId: 'openai-codex',
      groupId: 'team',
      reason: 'soft_threshold',
      observedProfileId: 'active',
    });
    expect(diagnostics).toContainEqual(expect.objectContaining({
      event: 'quota_work_requested',
      phase: 'soft_switch',
      reason: 'soft_switch_requested',
      sessionId: 'session-1',
      serviceId: 'openai-codex',
      groupId: 'team',
      activeProfileId: 'active',
      eligibilityStatus: 'eligible',
      sourceProfileId: 'active',
      sourceRemainingPercent: 5,
      sourceThresholdPercent: 15,
      selectedProfileId: 'backup',
      selectedRemainingPercent: 90,
      targetCount: 1,
      allowedTargetCount: 1,
    }));
  });

  it('suppresses proactive soft-threshold switching when no different group member is eligible', async () => {
    let now = 1_000_000;
    const resetAtMs = now + 600_000;
    const runtimeQuotaSnapshots = new ConnectedServiceAuthGroupRuntimeQuotaSnapshotStore();

    const credentials: Credentials = {
      token: 'happy-token',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(9) },
    };
    const activeRecord = buildConnectedServiceCredentialRecord({
      now,
      serviceId: 'openai-codex',
      profileId: 'active',
      kind: 'oauth',
      expiresAt: now + 60_000,
      oauth: {
        accessToken: 'access',
        refreshToken: 'refresh',
        idToken: null,
        scope: null,
        tokenType: null,
        providerAccountId: 'acct-active',
        providerEmail: 'active@example.com',
      },
    });
    const memberStates = new Map<string, Record<string, unknown>>([
      ['active', {
        quotaExhaustedUntilMs: resetAtMs,
        lastFailureKind: 'usage_limit',
        lastObservedAtMs: now - 1_000,
        providerResetsAtMs: resetAtMs,
      }],
      ['backup', {
        quotaExhaustedUntilMs: resetAtMs,
        lastFailureKind: 'usage_limit',
        lastObservedAtMs: now - 1_000,
        providerResetsAtMs: resetAtMs,
      }],
    ]);
    const buildGroup = () => ({
      v: 1,
      serviceId: 'openai-codex',
      groupId: 'team',
      displayName: 'Team',
      activeProfileId: 'active',
      generation: 1,
      policy: {
        v: 1,
        autoSwitch: true,
        strategy: 'priority',
        cooldownMs: 500,
      },
      state: { v: 1 },
      members: ['active', 'backup'].map((profileId, index) => ({
        v: 1,
        serviceId: 'openai-codex',
        groupId: 'team',
        profileId,
        priority: index,
        enabled: true,
        state: memberStates.get(profileId) ?? {},
        createdAt: index + 1,
        updatedAt: index + 1,
      })),
      createdAt: 1,
      updatedAt: 2,
    });

    const api = {
      getAccountEncryptionMode: vi.fn(async () => 'plain' as const),
      getConnectedServiceQuotaSnapshotPlain: vi.fn(async () => null),
      getConnectedServiceCredentialPlain: vi.fn(async () => ({ content: { t: 'plain' as const, v: activeRecord } })),
      registerConnectedServiceQuotaSnapshotPlain: vi.fn(async () => {}),
      getConnectedServiceQuotaSnapshotSealed: vi.fn(async () => null),
      getConnectedServiceCredentialSealed: vi.fn(async () => null),
      registerConnectedServiceQuotaSnapshotSealed: vi.fn(async () => {}),
      getConnectedServiceAuthGroup: vi.fn(async () => buildGroup()),
    } as unknown as QuotaApi;

    const fetcher: ConnectedServiceQuotaFetcher = {
      serviceId: 'openai-codex',
      fetch: vi.fn(async ({ record: inputRecord }: FetchArgs): Promise<ConnectedServiceQuotaSnapshotV1 | null> => ({
        v: 1,
        serviceId: inputRecord.serviceId,
        profileId: inputRecord.profileId,
        fetchedAt: now,
        staleAfterMs: 300_000,
        planLabel: 'Pro',
        accountLabel: 'active@example.com',
        meters: [
          {
            meterId: 'weekly',
            label: 'Weekly',
            used: null,
            limit: null,
            unit: 'unknown',
            utilizationPct: 95,
            remainingPct: 5,
            resetsAt: resetAtMs,
            status: 'ok',
            details: {},
          },
        ],
      })),
    };
    const switchBeforeTurn = vi.fn(async () => ({ status: 'switched' as const, activeProfileId: 'backup', generation: 2 }));
    const recordDiagnostic = vi.fn();
    const coordinator = new ConnectedServiceQuotasCoordinator({
      api,
      credentials,
      quotaFetchers: [fetcher],
      now: () => now,
      randomBytes: (length: number) => randomBytes(length),
      discoveryEnabled: false,
      authGroupSwitchCoordinator: { switchBeforeTurn },
      groupSwitchCheckMinIntervalMs: 0,
      runtimeQuotaSnapshots,
      recordDiagnostic,
    });

    coordinator.registerSpawnTarget({
      pid: 123,
      sessionId: 'session-1',
      connectedServicesBindingsRaw: {
        v: 1,
        bindingsByServiceId: {
          'openai-codex': {
            source: 'connected',
            selection: 'group',
            groupId: 'team',
          },
        },
      },
      connectedServiceSelectionsEnv: {
        [HAPPIER_CONNECTED_SERVICE_SELECTIONS_ENV_KEY]: JSON.stringify([{
          kind: 'group',
          serviceId: 'openai-codex',
          groupId: 'team',
          activeProfileId: 'active',
          fallbackProfileId: 'backup',
          generation: 1,
        }]),
      },
    });

    await coordinator.tickOnce();

    expect(switchBeforeTurn).not.toHaveBeenCalled();
    expect(recordDiagnostic).toHaveBeenCalledWith({
      event: 'quota_work_suppressed',
      phase: 'soft_switch',
      reason: 'group_exhausted_no_eligible_target',
      retryAfterMs: resetAtMs - now,
    });

    now = resetAtMs - 1;
    memberStates.set('backup', {});
    await coordinator.tickOnce();
    expect(switchBeforeTurn).not.toHaveBeenCalled();

    now = resetAtMs + 1;
    runtimeQuotaSnapshots.recordSnapshot({
      serviceId: 'openai-codex',
      groupId: 'team',
      profileId: 'backup',
      snapshot: {
        v: 1,
        serviceId: 'openai-codex',
        profileId: 'backup',
        fetchedAt: now,
        staleAfterMs: 300_000,
        planLabel: 'Pro',
        accountLabel: 'backup@example.com',
        meters: [
          {
            meterId: 'weekly',
            label: 'Weekly',
            used: null,
            limit: null,
            unit: 'unknown',
            utilizationPct: 10,
            remainingPct: 90,
            resetsAt: now + 600_000,
            status: 'ok',
            details: {},
          },
        ],
      },
    });
    await coordinator.tickOnce();
    expect(switchBeforeTurn).toHaveBeenCalledTimes(1);
    expect(switchBeforeTurn).toHaveBeenCalledWith({
      sessionId: 'session-1',
      serviceId: 'openai-codex',
      groupId: 'team',
      reason: 'soft_threshold',
      observedProfileId: 'active',
    });
  });

  it('suppresses proactive soft-threshold switching when the only different target is not meaningfully better', async () => {
    let now = 1_000_000;
    const resetAtMs = now + 600_000;
    const runtimeQuotaSnapshots = new ConnectedServiceAuthGroupRuntimeQuotaSnapshotStore();
    runtimeQuotaSnapshots.recordSnapshot({
      serviceId: 'openai-codex',
      groupId: 'team',
      profileId: 'backup',
      snapshot: {
        v: 1,
        serviceId: 'openai-codex',
        profileId: 'backup',
        fetchedAt: now,
        staleAfterMs: 300_000,
        planLabel: 'Pro',
        accountLabel: 'backup@example.com',
        meters: [{
          meterId: 'weekly',
          label: 'Weekly',
          used: null,
          limit: null,
          unit: 'unknown',
          utilizationPct: 90,
          remainingPct: 10,
          resetsAt: resetAtMs,
          status: 'ok',
          details: {},
        }],
      },
    });

    const credentials: Credentials = {
      token: 'happy-token',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(9) },
    };
    const activeRecord = buildConnectedServiceCredentialRecord({
      now,
      serviceId: 'openai-codex',
      profileId: 'active',
      kind: 'oauth',
      expiresAt: now + 60_000,
      oauth: {
        accessToken: 'access',
        refreshToken: 'refresh',
        idToken: null,
        scope: null,
        tokenType: null,
        providerAccountId: 'acct-active',
        providerEmail: 'active@example.com',
      },
    });
    const buildGroup = () => ({
      v: 1,
      serviceId: 'openai-codex',
      groupId: 'team',
      displayName: 'Team',
      activeProfileId: 'active',
      generation: 1,
      policy: {
        v: 1,
        autoSwitch: true,
        strategy: 'priority',
        cooldownMs: 500,
        softSwitchRemainingPercent: 15,
      },
      state: { v: 1 },
      members: ['active', 'backup'].map((profileId, index) => ({
        v: 1,
        serviceId: 'openai-codex',
        groupId: 'team',
        profileId,
        priority: index,
        enabled: true,
        state: {},
        createdAt: index + 1,
        updatedAt: index + 1,
      })),
      createdAt: 1,
      updatedAt: 2,
    });
    const api = {
      getAccountEncryptionMode: vi.fn(async () => 'plain' as const),
      getConnectedServiceQuotaSnapshotPlain: vi.fn(async () => null),
      getConnectedServiceCredentialPlain: vi.fn(async () => ({ content: { t: 'plain' as const, v: activeRecord } })),
      registerConnectedServiceQuotaSnapshotPlain: vi.fn(async () => {}),
      getConnectedServiceQuotaSnapshotSealed: vi.fn(async () => null),
      getConnectedServiceCredentialSealed: vi.fn(async () => null),
      registerConnectedServiceQuotaSnapshotSealed: vi.fn(async () => {}),
      getConnectedServiceAuthGroup: vi.fn(async () => buildGroup()),
    } as unknown as QuotaApi;
    const fetcher: ConnectedServiceQuotaFetcher = {
      serviceId: 'openai-codex',
      fetch: vi.fn(async ({ record: inputRecord }: FetchArgs): Promise<ConnectedServiceQuotaSnapshotV1 | null> => ({
        v: 1,
        serviceId: inputRecord.serviceId,
        profileId: inputRecord.profileId,
        fetchedAt: now,
        staleAfterMs: 300_000,
        planLabel: 'Pro',
        accountLabel: 'active@example.com',
        meters: [{
          meterId: 'weekly',
          label: 'Weekly',
          used: null,
          limit: null,
          unit: 'unknown',
          utilizationPct: 95,
          remainingPct: 5,
          resetsAt: resetAtMs,
          status: 'ok',
          details: {},
        }],
      })),
    };
    const switchBeforeTurn = vi.fn(async () => ({ status: 'switched' as const, activeProfileId: 'backup', generation: 2 }));
    const recordDiagnostic = vi.fn();
    const coordinator = new ConnectedServiceQuotasCoordinator({
      api,
      credentials,
      quotaFetchers: [fetcher],
      now: () => now,
      randomBytes: (length: number) => randomBytes(length),
      discoveryEnabled: false,
      authGroupSwitchCoordinator: { switchBeforeTurn },
      groupSwitchCheckMinIntervalMs: 0,
      runtimeQuotaSnapshots,
      recordDiagnostic,
    });

    coordinator.registerSpawnTarget({
      pid: 123,
      sessionId: 'session-1',
      connectedServicesBindingsRaw: {
        v: 1,
        bindingsByServiceId: {
          'openai-codex': {
            source: 'connected',
            selection: 'group',
            groupId: 'team',
          },
        },
      },
      connectedServiceSelectionsEnv: {
        [HAPPIER_CONNECTED_SERVICE_SELECTIONS_ENV_KEY]: JSON.stringify([{
          kind: 'group',
          serviceId: 'openai-codex',
          groupId: 'team',
          activeProfileId: 'active',
          fallbackProfileId: 'backup',
          generation: 1,
        }]),
      },
    });

    await coordinator.tickOnce();

    expect(switchBeforeTurn).not.toHaveBeenCalled();
    expect(recordDiagnostic).toHaveBeenCalledWith({
      event: 'quota_work_suppressed',
      phase: 'soft_switch',
      reason: 'soft_switch_no_meaningfully_better_target',
      retryAfterMs: resetAtMs - now,
    });

    now = resetAtMs + 1;
    runtimeQuotaSnapshots.recordSnapshot({
      serviceId: 'openai-codex',
      groupId: 'team',
      profileId: 'backup',
      snapshot: {
        v: 1,
        serviceId: 'openai-codex',
        profileId: 'backup',
        fetchedAt: now,
        staleAfterMs: 300_000,
        planLabel: 'Pro',
        accountLabel: 'backup@example.com',
        meters: [{
          meterId: 'weekly',
          label: 'Weekly',
          used: null,
          limit: null,
          unit: 'unknown',
          utilizationPct: 10,
          remainingPct: 90,
          resetsAt: now + 600_000,
          status: 'ok',
          details: {},
        }],
      },
    });
    await coordinator.tickOnce();

    expect(switchBeforeTurn).toHaveBeenCalledTimes(1);
    expect(switchBeforeTurn).toHaveBeenCalledWith({
      sessionId: 'session-1',
      serviceId: 'openai-codex',
      groupId: 'team',
      reason: 'soft_threshold',
      observedProfileId: 'active',
    });
  });

  it('suppresses proactive soft-threshold switching when the active profile remains above the threshold', async () => {
    const now = 1_000_000;
    const resetAtMs = now + 600_000;
    const runtimeQuotaSnapshots = new ConnectedServiceAuthGroupRuntimeQuotaSnapshotStore();
    runtimeQuotaSnapshots.recordSnapshot({
      serviceId: 'openai-codex',
      groupId: 'team',
      profileId: 'backup',
      snapshot: {
        v: 1,
        serviceId: 'openai-codex',
        profileId: 'backup',
        fetchedAt: now,
        staleAfterMs: 300_000,
        planLabel: 'Pro',
        accountLabel: 'backup@example.com',
        meters: [{
          meterId: 'weekly',
          label: 'Weekly',
          used: null,
          limit: null,
          unit: 'unknown',
          utilizationPct: 25,
          remainingPct: 75,
          resetsAt: resetAtMs,
          status: 'ok',
          details: {},
        }],
      },
    });

    const credentials: Credentials = {
      token: 'happy-token',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(9) },
    };
    const activeRecord = buildConnectedServiceCredentialRecord({
      now,
      serviceId: 'openai-codex',
      profileId: 'active',
      kind: 'oauth',
      expiresAt: now + 60_000,
      oauth: {
        accessToken: 'access',
        refreshToken: 'refresh',
        idToken: null,
        scope: null,
        tokenType: null,
        providerAccountId: 'acct-active',
        providerEmail: 'active@example.com',
      },
    });
    const buildGroup = () => ({
      v: 1,
      serviceId: 'openai-codex',
      groupId: 'team',
      displayName: 'Team',
      activeProfileId: 'active',
      generation: 1,
      policy: {
        v: 1,
        autoSwitch: true,
        strategy: 'priority',
        cooldownMs: 500,
        softSwitchRemainingPercent: 15,
      },
      state: { v: 1 },
      members: ['active', 'backup'].map((profileId, index) => ({
        v: 1,
        serviceId: 'openai-codex',
        groupId: 'team',
        profileId,
        priority: index,
        enabled: true,
        state: {},
        createdAt: index + 1,
        updatedAt: index + 1,
      })),
      createdAt: 1,
      updatedAt: 2,
    });
    const api = {
      getAccountEncryptionMode: vi.fn(async () => 'plain' as const),
      getConnectedServiceQuotaSnapshotPlain: vi.fn(async () => null),
      getConnectedServiceCredentialPlain: vi.fn(async () => ({ content: { t: 'plain' as const, v: activeRecord } })),
      registerConnectedServiceQuotaSnapshotPlain: vi.fn(async () => {}),
      getConnectedServiceQuotaSnapshotSealed: vi.fn(async () => null),
      getConnectedServiceCredentialSealed: vi.fn(async () => null),
      registerConnectedServiceQuotaSnapshotSealed: vi.fn(async () => {}),
      getConnectedServiceAuthGroup: vi.fn(async () => buildGroup()),
    } as unknown as QuotaApi;
    const fetcher: ConnectedServiceQuotaFetcher = {
      serviceId: 'openai-codex',
      fetch: vi.fn(async ({ record: inputRecord }: FetchArgs): Promise<ConnectedServiceQuotaSnapshotV1 | null> => ({
        v: 1,
        serviceId: inputRecord.serviceId,
        profileId: inputRecord.profileId,
        fetchedAt: now,
        staleAfterMs: 300_000,
        planLabel: 'Pro',
        accountLabel: 'active@example.com',
        meters: [{
          meterId: 'weekly',
          label: 'Weekly',
          used: null,
          limit: null,
          unit: 'unknown',
          utilizationPct: 48,
          remainingPct: 52,
          resetsAt: resetAtMs,
          status: 'ok',
          details: {},
        }],
      })),
    };
    const switchBeforeTurn = vi.fn(async () => ({ status: 'switched' as const, activeProfileId: 'backup', generation: 2 }));
    const recordDiagnostic = vi.fn();
    const coordinator = new ConnectedServiceQuotasCoordinator({
      api,
      credentials,
      quotaFetchers: [fetcher],
      now: () => now,
      randomBytes: (length: number) => randomBytes(length),
      discoveryEnabled: false,
      authGroupSwitchCoordinator: { switchBeforeTurn },
      groupSwitchCheckMinIntervalMs: 0,
      runtimeQuotaSnapshots,
      recordDiagnostic,
    });

    coordinator.registerSpawnTarget({
      pid: 123,
      sessionId: 'session-1',
      connectedServicesBindingsRaw: {
        v: 1,
        bindingsByServiceId: {
          'openai-codex': {
            source: 'connected',
            selection: 'group',
            groupId: 'team',
          },
        },
      },
      connectedServiceSelectionsEnv: {
        [HAPPIER_CONNECTED_SERVICE_SELECTIONS_ENV_KEY]: JSON.stringify([{
          kind: 'group',
          serviceId: 'openai-codex',
          groupId: 'team',
          activeProfileId: 'active',
          fallbackProfileId: 'backup',
          generation: 1,
        }]),
      },
    });

    await coordinator.tickOnce();

    expect(switchBeforeTurn).not.toHaveBeenCalled();
    expect(recordDiagnostic).toHaveBeenCalledWith(expect.objectContaining({
      event: 'quota_work_suppressed',
      phase: 'soft_switch',
      reason: 'soft_switch_no_meaningfully_better_target',
    }));
  });

  it('suppresses proactive soft-threshold switching when stale active-profile state hides fresh healthy quota', async () => {
    const now = 1_000_000;
    const resetAtMs = now + 600_000;
    const runtimeQuotaSnapshots = new ConnectedServiceAuthGroupRuntimeQuotaSnapshotStore();
    runtimeQuotaSnapshots.recordSnapshot({
      serviceId: 'openai-codex',
      groupId: 'team',
      profileId: 'backup',
      snapshot: {
        v: 1,
        serviceId: 'openai-codex',
        profileId: 'backup',
        fetchedAt: now,
        staleAfterMs: 300_000,
        planLabel: 'Pro',
        accountLabel: 'backup@example.com',
        meters: [{
          meterId: 'weekly',
          label: 'Weekly',
          used: null,
          limit: null,
          unit: 'unknown',
          utilizationPct: 25,
          remainingPct: 75,
          resetsAt: resetAtMs,
          status: 'ok',
          details: {},
        }],
      },
    });

    const credentials: Credentials = {
      token: 'happy-token',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(9) },
    };
    const activeRecord = buildConnectedServiceCredentialRecord({
      now,
      serviceId: 'openai-codex',
      profileId: 'active',
      kind: 'oauth',
      expiresAt: now + 60_000,
      oauth: {
        accessToken: 'access',
        refreshToken: 'refresh',
        idToken: null,
        scope: null,
        tokenType: null,
        providerAccountId: 'acct-active',
        providerEmail: 'active@example.com',
      },
    });
    const buildGroup = () => ({
      v: 1,
      serviceId: 'openai-codex',
      groupId: 'team',
      displayName: 'Team',
      activeProfileId: 'active',
      generation: 1,
      policy: {
        v: 1,
        autoSwitch: true,
        strategy: 'priority',
        cooldownMs: 500,
        softSwitchRemainingPercent: 15,
      },
      state: { v: 1 },
      members: ['active', 'backup'].map((profileId, index) => ({
        v: 1,
        serviceId: 'openai-codex',
        groupId: 'team',
        profileId,
        priority: index,
        enabled: true,
        state: profileId === 'active'
          ? {
              cooldownUntilMs: now + 30_000,
              cooldownStartedAtMs: now - 1_000,
            }
          : {},
        createdAt: index + 1,
        updatedAt: index + 1,
      })),
      createdAt: 1,
      updatedAt: 2,
    });
    const api = {
      getAccountEncryptionMode: vi.fn(async () => 'plain' as const),
      getConnectedServiceQuotaSnapshotPlain: vi.fn(async () => null),
      getConnectedServiceCredentialPlain: vi.fn(async () => ({ content: { t: 'plain' as const, v: activeRecord } })),
      registerConnectedServiceQuotaSnapshotPlain: vi.fn(async () => {}),
      getConnectedServiceQuotaSnapshotSealed: vi.fn(async () => null),
      getConnectedServiceCredentialSealed: vi.fn(async () => null),
      registerConnectedServiceQuotaSnapshotSealed: vi.fn(async () => {}),
      getConnectedServiceAuthGroup: vi.fn(async () => buildGroup()),
    } as unknown as QuotaApi;
    const fetcher: ConnectedServiceQuotaFetcher = {
      serviceId: 'openai-codex',
      fetch: vi.fn(async ({ record: inputRecord }: FetchArgs): Promise<ConnectedServiceQuotaSnapshotV1 | null> => ({
        v: 1,
        serviceId: inputRecord.serviceId,
        profileId: inputRecord.profileId,
        fetchedAt: now,
        staleAfterMs: 300_000,
        planLabel: 'Pro',
        accountLabel: 'active@example.com',
        meters: [{
          meterId: 'weekly',
          label: 'Weekly',
          used: null,
          limit: null,
          unit: 'unknown',
          utilizationPct: 48,
          remainingPct: 52,
          resetsAt: resetAtMs,
          status: 'ok',
          details: {},
        }],
      })),
    };
    const switchBeforeTurn = vi.fn(async () => ({ status: 'switched' as const, activeProfileId: 'backup', generation: 2 }));
    const recordDiagnostic = vi.fn();
    const coordinator = new ConnectedServiceQuotasCoordinator({
      api,
      credentials,
      quotaFetchers: [fetcher],
      now: () => now,
      randomBytes: (length: number) => randomBytes(length),
      discoveryEnabled: false,
      authGroupSwitchCoordinator: { switchBeforeTurn },
      groupSwitchCheckMinIntervalMs: 0,
      runtimeQuotaSnapshots,
      recordDiagnostic,
    });

    coordinator.registerSpawnTarget({
      pid: 123,
      sessionId: 'session-1',
      connectedServicesBindingsRaw: {
        v: 1,
        bindingsByServiceId: {
          'openai-codex': {
            source: 'connected',
            selection: 'group',
            groupId: 'team',
          },
        },
      },
      connectedServiceSelectionsEnv: {
        [HAPPIER_CONNECTED_SERVICE_SELECTIONS_ENV_KEY]: JSON.stringify([{
          kind: 'group',
          serviceId: 'openai-codex',
          groupId: 'team',
          activeProfileId: 'active',
          fallbackProfileId: 'backup',
          generation: 1,
        }]),
      },
    });

    await coordinator.tickOnce();

    expect(switchBeforeTurn).not.toHaveBeenCalled();
    expect(recordDiagnostic).toHaveBeenCalledWith(expect.objectContaining({
      event: 'quota_work_suppressed',
      phase: 'soft_switch',
      reason: 'soft_switch_no_meaningfully_better_target',
    }));
  });

  it('suppresses proactive soft-threshold switching when target eligibility cannot be resolved', async () => {
    const now = 1_000_000;
    const credentials: Credentials = {
      token: 'happy-token',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(9) },
    };
    const activeRecord = buildConnectedServiceCredentialRecord({
      now,
      serviceId: 'openai-codex',
      profileId: 'active',
      kind: 'oauth',
      expiresAt: now + 60_000,
      oauth: {
        accessToken: 'access',
        refreshToken: 'refresh',
        idToken: null,
        scope: null,
        tokenType: null,
        providerAccountId: 'acct-active',
        providerEmail: 'active@example.com',
      },
    });
    const api = {
      getAccountEncryptionMode: vi.fn(async () => 'plain' as const),
      getConnectedServiceQuotaSnapshotPlain: vi.fn(async () => null),
      getConnectedServiceCredentialPlain: vi.fn(async () => ({ content: { t: 'plain' as const, v: activeRecord } })),
      registerConnectedServiceQuotaSnapshotPlain: vi.fn(async () => {}),
      getConnectedServiceQuotaSnapshotSealed: vi.fn(async () => null),
      getConnectedServiceCredentialSealed: vi.fn(async () => null),
      registerConnectedServiceQuotaSnapshotSealed: vi.fn(async () => {}),
      getConnectedServiceAuthGroup: vi.fn(async () => {
        throw new Error('timeout of 5000ms exceeded');
      }),
    } as unknown as QuotaApi;

    const fetcher: ConnectedServiceQuotaFetcher = {
      serviceId: 'openai-codex',
      fetch: vi.fn(async ({ record: inputRecord }: FetchArgs): Promise<ConnectedServiceQuotaSnapshotV1 | null> => ({
        v: 1,
        serviceId: inputRecord.serviceId,
        profileId: inputRecord.profileId,
        fetchedAt: now,
        staleAfterMs: 300_000,
        planLabel: 'Pro',
        accountLabel: 'active@example.com',
        meters: [{
          meterId: 'weekly',
          label: 'Weekly',
          used: null,
          limit: null,
          unit: 'unknown',
          utilizationPct: 95,
          remainingPct: 5,
          resetsAt: null,
          status: 'ok',
          details: {},
        }],
      })),
    };
    const switchBeforeTurn = vi.fn(async () => ({ status: 'switched' as const, activeProfileId: 'backup', generation: 2 }));
    const recordDiagnostic = vi.fn();
    const coordinator = new ConnectedServiceQuotasCoordinator({
      api,
      credentials,
      quotaFetchers: [fetcher],
      now: () => now,
      randomBytes: (length: number) => randomBytes(length),
      discoveryEnabled: false,
      authGroupSwitchCoordinator: { switchBeforeTurn },
      groupSwitchCheckMinIntervalMs: 0,
      runtimeQuotaSnapshots: new ConnectedServiceAuthGroupRuntimeQuotaSnapshotStore(),
      recordDiagnostic,
    });

    coordinator.registerSpawnTarget({
      pid: 123,
      sessionId: 'session-1',
      connectedServicesBindingsRaw: {
        v: 1,
        bindingsByServiceId: {
          'openai-codex': {
            source: 'connected',
            selection: 'group',
            groupId: 'team',
          },
        },
      },
      connectedServiceSelectionsEnv: {
        [HAPPIER_CONNECTED_SERVICE_SELECTIONS_ENV_KEY]: JSON.stringify([{
          kind: 'group',
          serviceId: 'openai-codex',
          groupId: 'team',
          activeProfileId: 'active',
          fallbackProfileId: 'backup',
          generation: 1,
        }]),
      },
    });

    await coordinator.tickOnce();

    expect(api.getConnectedServiceAuthGroup).toHaveBeenCalledWith({
      serviceId: 'openai-codex',
      groupId: 'team',
    });
    expect(switchBeforeTurn).not.toHaveBeenCalled();
    expect(recordDiagnostic).toHaveBeenCalledWith({
      event: 'quota_work_suppressed',
      phase: 'soft_switch',
      reason: 'soft_switch_target_eligibility_unknown',
    });
  });

  it('suppresses proactive soft-threshold switching when runtime quota evidence is unhydrated', async () => {
    const now = 1_000_000;
    const credentials: Credentials = {
      token: 'happy-token',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(9) },
    };
    const activeRecord = buildConnectedServiceCredentialRecord({
      now,
      serviceId: 'openai-codex',
      profileId: 'active',
      kind: 'oauth',
      expiresAt: now + 60_000,
      oauth: {
        accessToken: 'access',
        refreshToken: 'refresh',
        idToken: null,
        scope: null,
        tokenType: null,
        providerAccountId: 'acct-active',
        providerEmail: 'active@example.com',
      },
    });
    const api = {
      getAccountEncryptionMode: vi.fn(async () => 'plain' as const),
      getConnectedServiceQuotaSnapshotPlain: vi.fn(async () => null),
      getConnectedServiceCredentialPlain: vi.fn(async () => ({ content: { t: 'plain' as const, v: activeRecord } })),
      registerConnectedServiceQuotaSnapshotPlain: vi.fn(async () => {}),
      getConnectedServiceQuotaSnapshotSealed: vi.fn(async () => null),
      getConnectedServiceCredentialSealed: vi.fn(async () => null),
      registerConnectedServiceQuotaSnapshotSealed: vi.fn(async () => {}),
    } as unknown as QuotaApi;
    const fetcher: ConnectedServiceQuotaFetcher = {
      serviceId: 'openai-codex',
      fetch: vi.fn(async ({ record: inputRecord }: FetchArgs): Promise<ConnectedServiceQuotaSnapshotV1 | null> => ({
        v: 1,
        serviceId: inputRecord.serviceId,
        profileId: inputRecord.profileId,
        fetchedAt: now,
        staleAfterMs: 300_000,
        planLabel: 'Pro',
        accountLabel: 'active@example.com',
        meters: [{
          meterId: 'weekly',
          label: 'Weekly',
          used: null,
          limit: null,
          unit: 'unknown',
          utilizationPct: 95,
          remainingPct: 5,
          resetsAt: null,
          status: 'ok',
          details: {},
        }],
      })),
    };
    const switchBeforeTurn = vi.fn(async () => ({ status: 'switched' as const, activeProfileId: 'backup', generation: 2 }));
    const recordDiagnostic = vi.fn();
    const coordinator = new ConnectedServiceQuotasCoordinator({
      api,
      credentials,
      quotaFetchers: [fetcher],
      now: () => now,
      randomBytes: (length: number) => randomBytes(length),
      discoveryEnabled: false,
      authGroupSwitchCoordinator: { switchBeforeTurn },
      groupSwitchCheckMinIntervalMs: 0,
      recordDiagnostic,
    });

    coordinator.registerSpawnTarget({
      pid: 123,
      sessionId: 'session-1',
      connectedServicesBindingsRaw: {
        v: 1,
        bindingsByServiceId: {
          'openai-codex': {
            source: 'connected',
            selection: 'group',
            groupId: 'team',
          },
        },
      },
      connectedServiceSelectionsEnv: {
        [HAPPIER_CONNECTED_SERVICE_SELECTIONS_ENV_KEY]: JSON.stringify([{
          kind: 'group',
          serviceId: 'openai-codex',
          groupId: 'team',
          activeProfileId: 'active',
          fallbackProfileId: 'backup',
          generation: 1,
        }]),
      },
    });

    await coordinator.tickOnce();

    expect(switchBeforeTurn).not.toHaveBeenCalled();
    expect(recordDiagnostic).toHaveBeenCalledWith({
      event: 'quota_work_suppressed',
      phase: 'soft_switch',
      reason: 'soft_switch_target_eligibility_unknown',
    });
  });

  it('suppresses proactive soft-threshold switching for a session with matching pending recovery', async () => {
    const now = 1_000_000;

    const credentials: Credentials = {
      token: 'happy-token',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(9) },
    };
    const activeRecord = buildConnectedServiceCredentialRecord({
      now,
      serviceId: 'openai-codex',
      profileId: 'active',
      kind: 'oauth',
      expiresAt: now + 60_000,
      oauth: {
        accessToken: 'access',
        refreshToken: 'refresh',
        idToken: null,
        scope: null,
        tokenType: null,
        providerAccountId: 'acct',
        providerEmail: 'user@example.com',
      },
    });
    const softSwitchEligibility = createSoftSwitchEligibilityFixture({
      serviceId: 'openai-codex',
      now,
    });

    const api = {
      getAccountEncryptionMode: vi.fn(async () => 'plain' as const),
      getConnectedServiceQuotaSnapshotPlain: vi.fn(async () => null),
      getConnectedServiceCredentialPlain: vi.fn(async () => ({ content: { t: 'plain' as const, v: activeRecord } })),
      registerConnectedServiceQuotaSnapshotPlain: vi.fn(async () => {}),
      getConnectedServiceQuotaSnapshotSealed: vi.fn(async () => null),
      getConnectedServiceCredentialSealed: vi.fn(async () => null),
      registerConnectedServiceQuotaSnapshotSealed: vi.fn(async () => {}),
      getConnectedServiceAuthGroup: softSwitchEligibility.getConnectedServiceAuthGroup,
    } as unknown as QuotaApi;

    const fetcher: ConnectedServiceQuotaFetcher = {
      serviceId: 'openai-codex',
      fetch: vi.fn(async ({ record: inputRecord }: FetchArgs): Promise<ConnectedServiceQuotaSnapshotV1 | null> => ({
        v: 1,
        serviceId: inputRecord.serviceId,
        profileId: inputRecord.profileId,
        fetchedAt: now,
        staleAfterMs: 300_000,
        planLabel: 'Pro',
        accountLabel: 'user@example.com',
        meters: [
          {
            meterId: 'weekly',
            label: 'Weekly',
            used: null,
            limit: null,
            unit: 'unknown',
            utilizationPct: 95,
            remainingPct: 5,
            resetsAt: now + 60_000,
            status: 'ok',
            details: {},
          },
        ],
      })),
    };
    const switchBeforeTurn = vi.fn(async () => ({ status: 'switched' as const, activeProfileId: 'backup', generation: 2 }));
    const softSwitchRecoveryGuard = vi.fn(async () => ({
      status: 'suppress' as const,
      reason: 'quota_soft_switch_suppressed_recovery_pending',
    }));
    const recordDiagnostic = vi.fn();
    const coordinator = new ConnectedServiceQuotasCoordinator({
      api,
      credentials,
      quotaFetchers: [fetcher],
      now: () => now,
      randomBytes: (length: number) => randomBytes(length),
      discoveryEnabled: false,
      runtimeQuotaSnapshots: softSwitchEligibility.runtimeQuotaSnapshots,
      authGroupSwitchCoordinator: { switchBeforeTurn },
      groupSwitchCheckMinIntervalMs: 0,
      softSwitchRecoveryGuard,
      recordDiagnostic,
    });

    coordinator.registerSpawnTarget({
      pid: 123,
      sessionId: 'session-1',
      connectedServicesBindingsRaw: {
        v: 1,
        bindingsByServiceId: {
          'openai-codex': {
            source: 'connected',
            selection: 'group',
            groupId: 'team',
          },
        },
      },
      connectedServiceSelectionsEnv: {
        [HAPPIER_CONNECTED_SERVICE_SELECTIONS_ENV_KEY]: JSON.stringify([{
          kind: 'group',
          serviceId: 'openai-codex',
          groupId: 'team',
          activeProfileId: 'active',
          fallbackProfileId: 'backup',
          generation: 1,
        }]),
      },
    });

    await coordinator.tickOnce();

    expect(softSwitchRecoveryGuard).toHaveBeenCalledWith({
      sessionId: 'session-1',
      serviceId: 'openai-codex',
      groupId: 'team',
      activeProfileId: 'active',
      reason: 'soft_threshold',
    });
    expect(switchBeforeTurn).not.toHaveBeenCalled();
    expect(recordDiagnostic).toHaveBeenCalledWith({
      event: 'quota_work_suppressed',
      phase: 'soft_switch',
      reason: 'quota_soft_switch_suppressed_recovery_pending',
    });
  });

  it('uses the canonical reported session id for proactive soft-threshold policy guards', async () => {
    const now = 1_000_000;

    const credentials: Credentials = {
      token: 'happy-token',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(9) },
    };
    const activeRecord = buildConnectedServiceCredentialRecord({
      now,
      serviceId: 'claude-subscription',
      profileId: 'active',
      kind: 'oauth',
      expiresAt: now + 60_000,
      oauth: {
        accessToken: 'access',
        refreshToken: 'refresh',
        idToken: null,
        scope: CLAUDE_SUBSCRIPTION_OAUTH_SCOPE,
        tokenType: 'Bearer',
        providerAccountId: 'acct',
        providerEmail: 'user@example.com',
      },
    });
    const softSwitchEligibility = createSoftSwitchEligibilityFixture({
      serviceId: 'claude-subscription',
      now,
    });

    const api = {
      getAccountEncryptionMode: vi.fn(async () => 'plain' as const),
      getConnectedServiceQuotaSnapshotPlain: vi.fn(async () => null),
      getConnectedServiceCredentialPlain: vi.fn(async () => ({ content: { t: 'plain' as const, v: activeRecord } })),
      registerConnectedServiceQuotaSnapshotPlain: vi.fn(async () => {}),
      getConnectedServiceQuotaSnapshotSealed: vi.fn(async () => null),
      getConnectedServiceCredentialSealed: vi.fn(async () => null),
      registerConnectedServiceQuotaSnapshotSealed: vi.fn(async () => {}),
      getConnectedServiceAuthGroup: softSwitchEligibility.getConnectedServiceAuthGroup,
    } as unknown as QuotaApi;

    const fetcher: ConnectedServiceQuotaFetcher = {
      serviceId: 'claude-subscription',
      fetch: vi.fn(async ({ record: inputRecord }: FetchArgs): Promise<ConnectedServiceQuotaSnapshotV1 | null> => ({
        v: 1,
        serviceId: inputRecord.serviceId,
        profileId: inputRecord.profileId,
        fetchedAt: now,
        staleAfterMs: 300_000,
        planLabel: 'Pro',
        accountLabel: 'user@example.com',
        meters: [
          {
            meterId: 'monthly',
            label: 'Monthly',
            used: null,
            limit: null,
            unit: 'unknown',
            utilizationPct: 95,
            remainingPct: 5,
            resetsAt: now + 60_000,
            status: 'ok',
            details: {},
          },
        ],
      })),
    };
    const switchBeforeTurn = vi.fn(async () => ({ status: 'switched' as const, activeProfileId: 'backup', generation: 2 }));
    const softSwitchPolicyGuard = vi.fn(async () => ({
      status: 'suppress' as const,
      reason: 'predictive_soft_switch_restart_required',
    }));
    const recordDiagnostic = vi.fn();
    const coordinator = new ConnectedServiceQuotasCoordinator({
      api,
      credentials,
      quotaFetchers: [fetcher],
      now: () => now,
      randomBytes: (length: number) => randomBytes(length),
      discoveryEnabled: false,
      runtimeQuotaSnapshots: softSwitchEligibility.runtimeQuotaSnapshots,
      authGroupSwitchCoordinator: { switchBeforeTurn },
      groupSwitchCheckMinIntervalMs: 0,
      softSwitchPolicyGuard,
      recordDiagnostic,
    });

    coordinator.registerSpawnTarget({
      pid: 123,
      sessionId: 'spawn-request-session',
      connectedServicesBindingsRaw: {
        v: 1,
        bindingsByServiceId: {
          'claude-subscription': {
            source: 'connected',
            selection: 'group',
            groupId: 'team',
          },
        },
      },
      connectedServiceSelectionsEnv: {
        [HAPPIER_CONNECTED_SERVICE_SELECTIONS_ENV_KEY]: JSON.stringify([{
          kind: 'group',
          serviceId: 'claude-subscription',
          groupId: 'team',
          activeProfileId: 'active',
          fallbackProfileId: 'backup',
          generation: 1,
        }]),
      },
    });
    coordinator.updateSpawnTargetSessionId({
      pid: 123,
      sessionId: 'canonical-session-1',
    });

    await coordinator.tickOnce();

    expect(softSwitchPolicyGuard).toHaveBeenCalledWith({
      sessionId: 'canonical-session-1',
      serviceId: 'claude-subscription',
      groupId: 'team',
      activeProfileId: 'active',
      reason: 'soft_threshold',
    });
    expect(switchBeforeTurn).not.toHaveBeenCalled();
    expect(recordDiagnostic).toHaveBeenCalledWith({
      event: 'quota_work_suppressed',
      phase: 'soft_switch',
      reason: 'predictive_soft_switch_restart_required',
    });
  });

  it('keeps proactive soft-threshold switching active for sessions without matching pending recovery', async () => {
    const now = 1_000_000;

    const credentials: Credentials = {
      token: 'happy-token',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(9) },
    };
    const activeRecord = buildConnectedServiceCredentialRecord({
      now,
      serviceId: 'openai-codex',
      profileId: 'active',
      kind: 'oauth',
      expiresAt: now + 60_000,
      oauth: {
        accessToken: 'access',
        refreshToken: 'refresh',
        idToken: null,
        scope: null,
        tokenType: null,
        providerAccountId: 'acct',
        providerEmail: 'user@example.com',
      },
    });
    const softSwitchEligibility = createSoftSwitchEligibilityFixture({
      serviceId: 'openai-codex',
      now,
    });

    const api = {
      getAccountEncryptionMode: vi.fn(async () => 'plain' as const),
      getConnectedServiceQuotaSnapshotPlain: vi.fn(async () => null),
      getConnectedServiceCredentialPlain: vi.fn(async () => ({ content: { t: 'plain' as const, v: activeRecord } })),
      registerConnectedServiceQuotaSnapshotPlain: vi.fn(async () => {}),
      getConnectedServiceQuotaSnapshotSealed: vi.fn(async () => null),
      getConnectedServiceCredentialSealed: vi.fn(async () => null),
      registerConnectedServiceQuotaSnapshotSealed: vi.fn(async () => {}),
      getConnectedServiceAuthGroup: softSwitchEligibility.getConnectedServiceAuthGroup,
    } as unknown as QuotaApi;

    const fetcher: ConnectedServiceQuotaFetcher = {
      serviceId: 'openai-codex',
      fetch: vi.fn(async ({ record: inputRecord }: FetchArgs): Promise<ConnectedServiceQuotaSnapshotV1 | null> => ({
        v: 1,
        serviceId: inputRecord.serviceId,
        profileId: inputRecord.profileId,
        fetchedAt: now,
        staleAfterMs: 300_000,
        planLabel: 'Pro',
        accountLabel: 'user@example.com',
        meters: [
          {
            meterId: 'weekly',
            label: 'Weekly',
            used: null,
            limit: null,
            unit: 'unknown',
            utilizationPct: 95,
            remainingPct: 5,
            resetsAt: now + 60_000,
            status: 'ok',
            details: {},
          },
        ],
      })),
    };
    const switchBeforeTurn = vi.fn(async () => ({ status: 'switched' as const, activeProfileId: 'backup', generation: 2 }));
    const softSwitchRecoveryGuard = vi.fn(async () => ({ status: 'allow' as const }));
    const coordinator = new ConnectedServiceQuotasCoordinator({
      api,
      credentials,
      quotaFetchers: [fetcher],
      now: () => now,
      randomBytes: (length: number) => randomBytes(length),
      discoveryEnabled: false,
      runtimeQuotaSnapshots: softSwitchEligibility.runtimeQuotaSnapshots,
      authGroupSwitchCoordinator: { switchBeforeTurn },
      groupSwitchCheckMinIntervalMs: 0,
      softSwitchRecoveryGuard,
    });

    coordinator.registerSpawnTarget({
      pid: 123,
      sessionId: 'session-1',
      connectedServicesBindingsRaw: {
        v: 1,
        bindingsByServiceId: {
          'openai-codex': {
            source: 'connected',
            selection: 'group',
            groupId: 'team',
          },
        },
      },
      connectedServiceSelectionsEnv: {
        [HAPPIER_CONNECTED_SERVICE_SELECTIONS_ENV_KEY]: JSON.stringify([{
          kind: 'group',
          serviceId: 'openai-codex',
          groupId: 'team',
          activeProfileId: 'active',
          fallbackProfileId: 'backup',
          generation: 1,
        }]),
      },
    });

    await coordinator.tickOnce();

    expect(softSwitchRecoveryGuard).toHaveBeenCalledWith({
      sessionId: 'session-1',
      serviceId: 'openai-codex',
      groupId: 'team',
      activeProfileId: 'active',
      reason: 'soft_threshold',
    });
    expect(switchBeforeTurn).toHaveBeenCalledTimes(1);
    expect(switchBeforeTurn).toHaveBeenCalledWith({
      sessionId: 'session-1',
      serviceId: 'openai-codex',
      groupId: 'team',
      reason: 'soft_threshold',
      observedProfileId: 'active',
    });
  });

  it('deduplicates proactive soft-threshold quota fetches while applying to every session sharing the same group and active profile', async () => {
    const now = 1_000_000;

    const credentials: Credentials = {
      token: 'happy-token',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(9) },
    };
    const activeRecord = buildConnectedServiceCredentialRecord({
      now,
      serviceId: 'openai-codex',
      profileId: 'active',
      kind: 'oauth',
      expiresAt: now + 60_000,
      oauth: {
        accessToken: 'access',
        refreshToken: 'refresh',
        idToken: null,
        scope: null,
        tokenType: null,
        providerAccountId: 'acct',
        providerEmail: 'user@example.com',
      },
    });
    const softSwitchEligibility = createSoftSwitchEligibilityFixture({
      serviceId: 'openai-codex',
      now,
    });
    const api = {
      getAccountEncryptionMode: vi.fn(async () => 'plain' as const),
      getConnectedServiceQuotaSnapshotPlain: vi.fn(async () => null),
      getConnectedServiceCredentialPlain: vi.fn(async () => ({ content: { t: 'plain' as const, v: activeRecord } })),
      registerConnectedServiceQuotaSnapshotPlain: vi.fn(async () => {}),
      getConnectedServiceQuotaSnapshotSealed: vi.fn(async () => null),
      getConnectedServiceCredentialSealed: vi.fn(async () => null),
      registerConnectedServiceQuotaSnapshotSealed: vi.fn(async () => {}),
      getConnectedServiceAuthGroup: softSwitchEligibility.getConnectedServiceAuthGroup,
    } as unknown as QuotaApi;
    const fetcher: ConnectedServiceQuotaFetcher = {
      serviceId: 'openai-codex',
      fetch: vi.fn(async ({ record: inputRecord }: FetchArgs): Promise<ConnectedServiceQuotaSnapshotV1 | null> => buildQuotaSnapshotFixture({
        serviceId: inputRecord.serviceId,
        profileId: inputRecord.profileId,
        now,
        remainingPct: 5,
      })),
    };
    let groupDecisionCount = 0;
    let groupDecisionInFlight = false;
    const switchBeforeTurn = vi.fn(async (_input: Readonly<{
      sessionId?: string;
      serviceId: string;
      groupId: string;
      reason: 'soft_threshold';
    }>) => {
      if (!groupDecisionInFlight) {
        groupDecisionInFlight = true;
        groupDecisionCount++;
        await Promise.resolve();
        groupDecisionInFlight = false;
        return { status: 'switched' as const, activeProfileId: 'backup', generation: 2 };
      }
      await Promise.resolve();
      return { status: 'observed_generation' as const, activeProfileId: 'backup', generation: 2 };
    });
    const coordinator = new ConnectedServiceQuotasCoordinator({
      api,
      credentials,
      quotaFetchers: [fetcher],
      now: () => now,
      randomBytes: (length: number) => randomBytes(length),
      discoveryEnabled: false,
      runtimeQuotaSnapshots: softSwitchEligibility.runtimeQuotaSnapshots,
      authGroupSwitchCoordinator: { switchBeforeTurn },
      groupSwitchCheckMinIntervalMs: 0,
    });

    for (const [pid, sessionId] of [[123, 'session-1'], [456, 'session-2']] as const) {
      coordinator.registerSpawnTarget({
        pid,
        sessionId,
        connectedServicesBindingsRaw: {
          v: 1,
          bindingsByServiceId: {
            'openai-codex': {
              source: 'connected',
              selection: 'group',
              groupId: 'team',
            },
          },
        },
        connectedServiceSelectionsEnv: {
          [HAPPIER_CONNECTED_SERVICE_SELECTIONS_ENV_KEY]: JSON.stringify([{
            kind: 'group',
            serviceId: 'openai-codex',
            groupId: 'team',
            activeProfileId: 'active',
            fallbackProfileId: 'backup',
            generation: 1,
          }]),
        },
      });
    }

    await coordinator.tickOnce();

    expect(fetcher.fetch).toHaveBeenCalledTimes(1);
    expect(groupDecisionCount).toBe(1);
    expect(switchBeforeTurn).toHaveBeenCalledTimes(2);
    const calls = switchBeforeTurn.mock.calls
      .map((call) => call[0])
      .sort((a, b) => String(a.sessionId).localeCompare(String(b.sessionId)));
    expect(calls).toEqual([
      {
        sessionId: 'session-1',
        serviceId: 'openai-codex',
        groupId: 'team',
        reason: 'soft_threshold',
        observedProfileId: 'active',
      },
      {
        sessionId: 'session-2',
        serviceId: 'openai-codex',
        groupId: 'team',
        reason: 'soft_threshold',
        observedProfileId: 'active',
      },
    ]);
  });

  it('keeps proactive soft-threshold checks independent for distinct active profiles in the same group', async () => {
    const now = 1_000_000;

    const credentials: Credentials = {
      token: 'happy-token',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(9) },
    };
    const records = new Map(['active-a', 'active-b'].map((profileId) => [profileId, buildConnectedServiceCredentialRecord({
      now,
      serviceId: 'openai-codex',
      profileId,
      kind: 'oauth',
      expiresAt: now + 60_000,
      oauth: {
        accessToken: `${profileId}-access`,
        refreshToken: `${profileId}-refresh`,
        idToken: null,
        scope: null,
        tokenType: null,
        providerAccountId: `${profileId}-acct`,
        providerEmail: `${profileId}@example.com`,
      },
    })]));
    const softSwitchEligibility = createSoftSwitchEligibilityFixture({
      serviceId: 'openai-codex',
      now,
      activeProfileId: 'active-a',
      memberProfileIds: ['active-b'],
      targetProfileIds: ['backup'],
    });
    const api = {
      getAccountEncryptionMode: vi.fn(async () => 'plain' as const),
      getConnectedServiceQuotaSnapshotPlain: vi.fn(async () => null),
      getConnectedServiceCredentialPlain: vi.fn(async ({ profileId }: { profileId: string }) => ({
        content: { t: 'plain' as const, v: records.get(profileId)! },
      })),
      registerConnectedServiceQuotaSnapshotPlain: vi.fn(async () => {}),
      getConnectedServiceQuotaSnapshotSealed: vi.fn(async () => null),
      getConnectedServiceCredentialSealed: vi.fn(async () => null),
      registerConnectedServiceQuotaSnapshotSealed: vi.fn(async () => {}),
      getConnectedServiceAuthGroup: softSwitchEligibility.getConnectedServiceAuthGroup,
    } as unknown as QuotaApi;
    const fetcher: ConnectedServiceQuotaFetcher = {
      serviceId: 'openai-codex',
      fetch: vi.fn(async ({ record: inputRecord }: FetchArgs): Promise<ConnectedServiceQuotaSnapshotV1 | null> => buildQuotaSnapshotFixture({
        serviceId: inputRecord.serviceId,
        profileId: inputRecord.profileId,
        now,
        remainingPct: 5,
      })),
    };
    const switchBeforeTurn = vi.fn(async (_input: Readonly<{
      sessionId?: string;
      serviceId: string;
      groupId: string;
      reason: 'soft_threshold';
    }>) => ({ status: 'no_eligible_profile' as const }));
    const coordinator = new ConnectedServiceQuotasCoordinator({
      api,
      credentials,
      quotaFetchers: [fetcher],
      now: () => now,
      randomBytes: (length: number) => randomBytes(length),
      discoveryEnabled: false,
      runtimeQuotaSnapshots: softSwitchEligibility.runtimeQuotaSnapshots,
      authGroupSwitchCoordinator: { switchBeforeTurn },
      groupSwitchCheckMinIntervalMs: 0,
    });

    for (const [pid, sessionId, activeProfileId] of [
      [123, 'session-1', 'active-a'],
      [456, 'session-2', 'active-b'],
    ] as const) {
      coordinator.registerSpawnTarget({
        pid,
        sessionId,
        connectedServicesBindingsRaw: {
          v: 1,
          bindingsByServiceId: {
            'openai-codex': {
              source: 'connected',
              selection: 'group',
              groupId: 'team',
            },
          },
        },
        connectedServiceSelectionsEnv: {
          [HAPPIER_CONNECTED_SERVICE_SELECTIONS_ENV_KEY]: JSON.stringify([{
            kind: 'group',
            serviceId: 'openai-codex',
            groupId: 'team',
            activeProfileId,
            fallbackProfileId: 'backup',
            generation: 1,
          }]),
        },
      });
    }

    await coordinator.tickOnce();

    expect(fetcher.fetch).toHaveBeenCalledTimes(2);
    expect(switchBeforeTurn).toHaveBeenCalledTimes(2);
    const calledSessionIds = switchBeforeTurn.mock.calls
      .map((call) => (call[0] as Readonly<{ sessionId?: string }>).sessionId)
      .sort();
    expect(calledSessionIds).toEqual(['session-1', 'session-2']);
    const calledObservedProfileIds = switchBeforeTurn.mock.calls
      .map((call) => (call[0] as Readonly<{ observedProfileId?: string }>).observedProfileId)
      .sort();
    expect(calledObservedProfileIds).toEqual(['active-a', 'active-b']);
  });

  it('uses deterministic bounded jitter when scheduling the next proactive soft-threshold check', async () => {
    let now = 1_000_000;

    const credentials: Credentials = {
      token: 'happy-token',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(9) },
    };
    const snapshot = buildQuotaSnapshotFixture({
      serviceId: 'openai-codex',
      profileId: 'active',
      now,
      remainingPct: 5,
    });
    const softSwitchEligibility = createSoftSwitchEligibilityFixture({
      serviceId: 'openai-codex',
      now,
    });
    const api = {
      getAccountEncryptionMode: vi.fn(async () => 'plain' as const),
      getConnectedServiceQuotaSnapshotPlain: vi.fn(async () => ({
        content: { t: 'plain' as const, v: snapshot },
        metadata: {
          fetchedAt: snapshot.fetchedAt,
          staleAfterMs: snapshot.staleAfterMs,
          status: 'ok' as const,
        },
      })),
      getConnectedServiceCredentialPlain: vi.fn(async () => {
        throw new Error('fresh quota should not fetch credentials');
      }),
      registerConnectedServiceQuotaSnapshotPlain: vi.fn(async () => {}),
      getConnectedServiceQuotaSnapshotSealed: vi.fn(async () => null),
      getConnectedServiceCredentialSealed: vi.fn(async () => null),
      registerConnectedServiceQuotaSnapshotSealed: vi.fn(async () => {}),
      getConnectedServiceAuthGroup: softSwitchEligibility.getConnectedServiceAuthGroup,
    } as unknown as QuotaApi;
    const fetcher: ConnectedServiceQuotaFetcher = {
      serviceId: 'openai-codex',
      fetch: vi.fn(async () => null),
    };
    const switchBeforeTurn = vi.fn(async () => ({ status: 'no_eligible_profile' as const }));
    const coordinator = new ConnectedServiceQuotasCoordinator({
      api,
      credentials,
      quotaFetchers: [fetcher],
      now: () => now,
      randomBytes: (length: number) => new Uint8Array(length).fill(128),
      discoveryEnabled: false,
      runtimeQuotaSnapshots: softSwitchEligibility.runtimeQuotaSnapshots,
      authGroupSwitchCoordinator: { switchBeforeTurn },
      groupSwitchCheckMinIntervalMs: 1_000,
      groupSwitchCheckJitterMs: 500,
    });
    coordinator.registerSpawnTarget({
      pid: 123,
      sessionId: 'session-1',
      connectedServicesBindingsRaw: {
        v: 1,
        bindingsByServiceId: {
          'openai-codex': {
            source: 'connected',
            selection: 'group',
            groupId: 'team',
          },
        },
      },
      connectedServiceSelectionsEnv: {
        [HAPPIER_CONNECTED_SERVICE_SELECTIONS_ENV_KEY]: JSON.stringify([{
          kind: 'group',
          serviceId: 'openai-codex',
          groupId: 'team',
          activeProfileId: 'active',
          fallbackProfileId: 'backup',
          generation: 1,
        }]),
      },
    });

    await coordinator.tickOnce();
    now += 1_249;
    await coordinator.tickOnce();
    expect(switchBeforeTurn).toHaveBeenCalledTimes(1);

    now += 1;
    await coordinator.tickOnce();
    expect(switchBeforeTurn).toHaveBeenCalledTimes(2);
  });

  it('defers quota probes and proactive switch attempts while the local-server storm gate is closed', async () => {
    const now = 1_000_000;

    const credentials: Credentials = {
      token: 'happy-token',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(9) },
    };
    const api = {
      getAccountEncryptionMode: vi.fn(async () => 'plain' as const),
      getConnectedServiceQuotaSnapshotPlain: vi.fn(async () => null),
      getConnectedServiceCredentialPlain: vi.fn(async () => null),
      registerConnectedServiceQuotaSnapshotPlain: vi.fn(async () => {}),
      getConnectedServiceQuotaSnapshotSealed: vi.fn(async () => null),
      getConnectedServiceCredentialSealed: vi.fn(async () => null),
      registerConnectedServiceQuotaSnapshotSealed: vi.fn(async () => {}),
    } as unknown as QuotaApi;
    const fetcher: ConnectedServiceQuotaFetcher = {
      serviceId: 'openai-codex',
      fetch: vi.fn(async () => null),
    };
    const switchBeforeTurn = vi.fn(async () => ({ status: 'no_eligible_profile' as const }));
    const recordDiagnostic = vi.fn();
    const coordinator = new ConnectedServiceQuotasCoordinator({
      api,
      credentials,
      quotaFetchers: [fetcher],
      now: () => now,
      randomBytes: (length: number) => randomBytes(length),
      discoveryEnabled: false,
      authGroupSwitchCoordinator: { switchBeforeTurn },
      quotaWorkGate: () => ({ status: 'deferred', reason: 'local_server_storm', retryAfterMs: 2_000 }),
      recordDiagnostic,
    });
    coordinator.registerSpawnTarget({
      pid: 123,
      sessionId: 'session-1',
      connectedServicesBindingsRaw: {
        v: 1,
        bindingsByServiceId: {
          'openai-codex': {
            source: 'connected',
            selection: 'group',
            groupId: 'team',
          },
        },
      },
      connectedServiceSelectionsEnv: {
        [HAPPIER_CONNECTED_SERVICE_SELECTIONS_ENV_KEY]: JSON.stringify([{
          kind: 'group',
          serviceId: 'openai-codex',
          groupId: 'team',
          activeProfileId: 'active',
          fallbackProfileId: 'backup',
          generation: 1,
        }]),
      },
    });

    await coordinator.tickOnce();

    expect(api.getAccountEncryptionMode).not.toHaveBeenCalled();
    expect(fetcher.fetch).not.toHaveBeenCalled();
    expect(switchBeforeTurn).not.toHaveBeenCalled();
    expect(recordDiagnostic).toHaveBeenCalledWith({
      event: 'quota_work_deferred',
      phase: 'tick',
      reason: 'local_server_storm',
      retryAfterMs: 2_000,
    });
  });

  it('keeps active-group soft switching independent from quota persistence failures', async () => {
    const now = 1_000_000;
    const softSwitchEligibility = createSoftSwitchEligibilityFixture({
      serviceId: 'openai-codex',
      now,
    });
    const runtimeQuotaSnapshots = softSwitchEligibility.runtimeQuotaSnapshots;

    const credentials: Credentials = {
      token: 'happy-token',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(9) },
    };

    const activeRecord = buildConnectedServiceCredentialRecord({
      now,
      serviceId: 'openai-codex',
      profileId: 'active',
      kind: 'oauth',
      expiresAt: now + 60_000,
      oauth: {
        accessToken: 'access',
        refreshToken: 'refresh',
        idToken: null,
        scope: null,
        tokenType: null,
        providerAccountId: 'acct',
        providerEmail: 'user@example.com',
      },
    });

    const api = {
      getAccountEncryptionMode: vi.fn(async () => 'plain' as const),
      getConnectedServiceQuotaSnapshotPlain: vi.fn(async () => null),
      getConnectedServiceCredentialPlain: vi.fn(async () => ({ content: { t: 'plain' as const, v: activeRecord } })),
      registerConnectedServiceQuotaSnapshotPlain: vi.fn(async () => {
        throw new Error('server timeout');
      }),
      getConnectedServiceQuotaSnapshotSealed: vi.fn(async () => null),
      getConnectedServiceCredentialSealed: vi.fn(async () => null),
      registerConnectedServiceQuotaSnapshotSealed: vi.fn(async () => {}),
      getConnectedServiceAuthGroup: softSwitchEligibility.getConnectedServiceAuthGroup,
    } as unknown as QuotaApi;

    const snapshot: ConnectedServiceQuotaSnapshotV1 = {
      v: 1,
      serviceId: 'openai-codex',
      profileId: 'active',
      fetchedAt: now,
      staleAfterMs: 300_000,
      planLabel: 'Pro',
      accountLabel: 'user@example.com',
      meters: [
        {
          meterId: 'weekly',
          label: 'Weekly',
          used: null,
          limit: null,
          unit: 'unknown',
          utilizationPct: 95,
          remainingPct: 5,
          resetsAt: now + 60_000,
          status: 'ok',
          details: {},
        },
      ],
    };
    const fetcher: ConnectedServiceQuotaFetcher = {
      serviceId: 'openai-codex',
      fetch: vi.fn(async (): Promise<ConnectedServiceQuotaSnapshotV1 | null> => snapshot),
    };
    const switchBeforeTurn = vi.fn(async () => ({ status: 'switched' as const, activeProfileId: 'backup', generation: 2 }));
    const coordinator = new ConnectedServiceQuotasCoordinator({
      api,
      credentials,
      quotaFetchers: [fetcher],
      now: () => now,
      randomBytes: (length: number) => randomBytes(length),
      discoveryEnabled: false,
      runtimeQuotaSnapshots,
      authGroupSwitchCoordinator: { switchBeforeTurn },
      groupSwitchCheckMinIntervalMs: 0,
    });

    coordinator.registerSpawnTarget({
      pid: 123,
      sessionId: 'session-1',
      connectedServicesBindingsRaw: {
        v: 1,
        bindingsByServiceId: {
          'openai-codex': {
            source: 'connected',
            selection: 'group',
            groupId: 'team',
          },
        },
      },
      connectedServiceSelectionsEnv: {
        [HAPPIER_CONNECTED_SERVICE_SELECTIONS_ENV_KEY]: JSON.stringify([{
          kind: 'group',
          serviceId: 'openai-codex',
          groupId: 'team',
          activeProfileId: 'active',
          fallbackProfileId: 'backup',
          generation: 1,
        }]),
      },
    });

    await coordinator.tickOnce();

    expect(runtimeQuotaSnapshots.getSnapshot({
      serviceId: 'openai-codex',
      groupId: 'team',
      profileId: 'active',
    })).toBe(snapshot);
    expect(switchBeforeTurn).toHaveBeenCalledTimes(1);
    expect(switchBeforeTurn).toHaveBeenCalledWith({
      sessionId: 'session-1',
      serviceId: 'openai-codex',
      groupId: 'team',
      reason: 'soft_threshold',
      observedProfileId: 'active',
    });
  });

  it('hot-applies only sibling sessions proven on the same live provider account after account exhaustion', async () => {
    const now = 1_000_000;
    const credentials: Credentials = {
      token: 'happy-token',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(9) },
    };
    const api = {
      getAccountEncryptionMode: vi.fn(async () => 'plain' as const),
      getConnectedServiceQuotaSnapshotPlain: vi.fn(async () => null),
      getConnectedServiceCredentialPlain: vi.fn(async () => null),
      registerConnectedServiceQuotaSnapshotPlain: vi.fn(async () => {}),
      getConnectedServiceQuotaSnapshotSealed: vi.fn(async () => null),
      getConnectedServiceCredentialSealed: vi.fn(async () => null),
      registerConnectedServiceQuotaSnapshotSealed: vi.fn(async () => {}),
    } as unknown as QuotaApi;
    const switchBeforeTurn = vi.fn(async () => ({ status: 'switched' as const, activeProfileId: 'backup', generation: 2 }));
    const coordinator = new ConnectedServiceQuotasCoordinator({
      api,
      credentials,
      quotaFetchers: [],
      now: () => now,
      randomBytes: (length: number) => randomBytes(length),
      authGroupSwitchCoordinator: { switchBeforeTurn },
      groupSwitchCheckMinIntervalMs: 0,
      sameAccountFanoutStrategyResolver: () => 'provider_account_id',
    });
    const registerGroupSession = (sessionId: string, pid: number) => {
      coordinator.registerSpawnTarget({
        pid,
        sessionId,
        connectedServicesBindingsRaw: {
          v: 1,
          bindingsByServiceId: {
            'openai-codex': {
              source: 'connected',
              selection: 'group',
              groupId: 'team',
            },
          },
        },
        connectedServiceSelectionsEnv: {
          [HAPPIER_CONNECTED_SERVICE_SELECTIONS_ENV_KEY]: JSON.stringify([{
            kind: 'group',
            serviceId: 'openai-codex',
            groupId: 'team',
            activeProfileId: 'primary',
            fallbackProfileId: 'backup',
            generation: 4,
          }]),
        },
      });
    };
    registerGroupSession('source', 101);
    registerGroupSession('same-account', 102);
    registerGroupSession('different-account', 103);
    registerGroupSession('unknown-account', 104);

    coordinator.recordRuntimeAccountIdentityFromSnapshot({
      sessionId: 'source',
      serviceId: 'openai-codex',
      groupId: 'team',
      profileId: 'primary',
      providerAccountId: 'acct-a',
      accountLabel: null,
      observedAtMs: now,
      source: 'runtime_quota_snapshot',
      proofStrength: 'exact',
      groupGeneration: 4,
    });
    coordinator.recordRuntimeAccountIdentityFromSnapshot({
      sessionId: 'same-account',
      serviceId: 'openai-codex',
      groupId: 'team',
      profileId: 'primary',
      providerAccountId: 'acct-a',
      accountLabel: null,
      observedAtMs: now,
      source: 'active_account_verification',
      proofStrength: 'exact',
      groupGeneration: 4,
    });
    coordinator.recordRuntimeAccountIdentityFromSnapshot({
      sessionId: 'different-account',
      serviceId: 'openai-codex',
      groupId: 'team',
      profileId: 'primary',
      providerAccountId: 'acct-b',
      accountLabel: null,
      observedAtMs: now,
      source: 'active_account_verification',
      proofStrength: 'exact',
      groupGeneration: 4,
    });

    await expect(coordinator.recordAccountExhaustionAndFanout({
      sourceSessionId: 'source',
      serviceId: 'openai-codex',
      groupId: 'team',
      exhaustedProfileId: 'primary',
      providerAccountId: 'acct-a',
      resetAtMs: null,
      reason: 'usage_limit',
    })).resolves.toEqual({
      status: 'recorded',
      fanoutCandidates: 1,
      fanoutRequests: 1,
    });

    expect(switchBeforeTurn).toHaveBeenCalledTimes(1);
    expect(switchBeforeTurn).toHaveBeenCalledWith({
      sessionId: 'same-account',
      serviceId: 'openai-codex',
      groupId: 'team',
      reason: 'same_provider_account_exhausted',
      observedProfileId: 'primary',
    });
  });

  it('applies warmed direct-live-capable same-account siblings immediately when runtime reconciliation reports an active provider turn', async () => {
    const now = 1_000_000;
    const credentials: Credentials = {
      token: 'happy-token',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(9) },
    };
    const api = {
      getAccountEncryptionMode: vi.fn(async () => 'plain' as const),
      getConnectedServiceQuotaSnapshotPlain: vi.fn(async () => null),
      getConnectedServiceCredentialPlain: vi.fn(async () => null),
      registerConnectedServiceQuotaSnapshotPlain: vi.fn(async () => {}),
      getConnectedServiceQuotaSnapshotSealed: vi.fn(async () => null),
      getConnectedServiceCredentialSealed: vi.fn(async () => null),
      registerConnectedServiceQuotaSnapshotSealed: vi.fn(async () => {}),
    } as unknown as QuotaApi;
    const switchBeforeTurn = vi.fn(async () => ({ status: 'switched' as const, activeProfileId: 'backup', generation: 2 }));
    const readRuntimeAccountIdentity = vi.fn(async () => ({
      status: 'verified' as const,
      providerAccountId: 'acct-a',
      accountLabel: 'same@example.com',
      proofStrength: 'exact' as const,
      source: 'runtime_identity_probe' as const,
      runtime: {
        inProviderTurn: true,
        safeToApply: false,
      },
    }));
    const diagnostics: unknown[] = [];
    const coordinatorParams = {
      api,
      credentials,
      quotaFetchers: [],
      now: () => now,
      randomBytes: (length: number) => randomBytes(length),
      authGroupSwitchCoordinator: { switchBeforeTurn },
      groupSwitchCheckMinIntervalMs: 0,
      sameAccountFanoutStrategyResolver: () => 'provider_account_id' as const,
      runtimeAuthApplyCapabilityResolver: (input: Readonly<{
        sourceSessionId: string;
        targetSessionId?: string;
      }>) => input.targetSessionId === 'same-account'
        ? directLiveExternalTokenInjectionCapability
        : { directLiveHotAuth: 'unsupported' },
      readRuntimeAccountIdentity,
      recordDiagnostic: (event: unknown) => diagnostics.push(event),
    } satisfies ConstructorParameters<typeof ConnectedServiceQuotasCoordinator>[0] & {
      readRuntimeAccountIdentity: typeof readRuntimeAccountIdentity;
    };
    const coordinator = new ConnectedServiceQuotasCoordinator(coordinatorParams);
    for (const [sessionId, pid] of [['source', 491], ['same-account', 492]] as const) {
      coordinator.registerSpawnTarget({
        pid,
        sessionId,
        connectedServicesBindingsRaw: {
          v: 1,
          bindingsByServiceId: {
            'openai-codex': {
              source: 'connected',
              selection: 'group',
              groupId: 'team',
            },
          },
        },
        connectedServiceSelectionsEnv: {
          [HAPPIER_CONNECTED_SERVICE_SELECTIONS_ENV_KEY]: JSON.stringify([{
            kind: 'group',
            serviceId: 'openai-codex',
            groupId: 'team',
            activeProfileId: 'primary',
            fallbackProfileId: 'backup',
            generation: 4,
          }]),
        },
      });
      coordinator.recordRuntimeAccountIdentityFromSnapshot({
        sessionId,
        serviceId: 'openai-codex',
        groupId: 'team',
        profileId: 'primary',
        providerAccountId: 'acct-a',
        accountLabel: null,
        observedAtMs: now,
        source: 'active_account_verification',
        proofStrength: 'exact',
        groupGeneration: 4,
      });
    }

    await expect(coordinator.recordAccountExhaustionAndFanout({
      sourceSessionId: 'source',
      serviceId: 'openai-codex',
      groupId: 'team',
      exhaustedProfileId: 'primary',
      providerAccountId: 'acct-a',
      resetAtMs: null,
      reason: 'usage_limit',
    })).resolves.toEqual({
      status: 'recorded',
      fanoutCandidates: 1,
      fanoutRequests: 1,
    });

    expect(readRuntimeAccountIdentity).toHaveBeenCalledTimes(1);
    expect(readRuntimeAccountIdentity).toHaveBeenCalledWith({
      sessionId: 'same-account',
      serviceId: 'openai-codex',
      groupId: 'team',
      profileId: 'primary',
      expectedGroupGeneration: 4,
    });
    expect(switchBeforeTurn).toHaveBeenCalledTimes(1);
    expect(switchBeforeTurn).toHaveBeenCalledWith({
      sessionId: 'same-account',
      serviceId: 'openai-codex',
      groupId: 'team',
      reason: 'same_provider_account_exhausted',
      observedProfileId: 'primary',
    });
    expect(diagnostics).not.toContainEqual(expect.objectContaining({
      event: 'quota_work_deferred',
      phase: 'same_account_fanout',
      reason: 'same_account_fanout_candidate_deferred_until_turn_boundary',
    }));
  });

  it('seeds exact runtime account identity from connected-service spawn selection before quota snapshots arrive', async () => {
    const now = 1_000_000;
    const credentials: Credentials = {
      token: 'happy-token',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(9) },
    };
    const api = {
      getAccountEncryptionMode: vi.fn(async () => 'plain' as const),
      getConnectedServiceQuotaSnapshotPlain: vi.fn(async () => null),
      getConnectedServiceCredentialPlain: vi.fn(async () => null),
      registerConnectedServiceQuotaSnapshotPlain: vi.fn(async () => {}),
      getConnectedServiceQuotaSnapshotSealed: vi.fn(async () => null),
      getConnectedServiceCredentialSealed: vi.fn(async () => null),
      registerConnectedServiceQuotaSnapshotSealed: vi.fn(async () => {}),
    } as unknown as QuotaApi;
    const switchBeforeTurn = vi.fn(async () => ({ status: 'switched' as const, activeProfileId: 'backup', generation: 5 }));
    const coordinator = new ConnectedServiceQuotasCoordinator({
      api,
      credentials,
      quotaFetchers: [],
      now: () => now,
      randomBytes: (length: number) => randomBytes(length),
      authGroupSwitchCoordinator: { switchBeforeTurn },
      groupSwitchCheckMinIntervalMs: 0,
      sameAccountFanoutStrategyResolver: () => 'provider_account_id',
    });
    const registerGroupSession = (sessionId: string, pid: number, providerAccountId: string) => {
      coordinator.registerSpawnTarget({
        pid,
        sessionId,
        connectedServicesBindingsRaw: {
          v: 1,
          bindingsByServiceId: {
            'openai-codex': {
              source: 'connected',
              selection: 'group',
              groupId: 'team',
            },
          },
        },
        connectedServiceSelectionsEnv: {
          [HAPPIER_CONNECTED_SERVICE_SELECTIONS_ENV_KEY]: JSON.stringify([{
            kind: 'group',
            serviceId: 'openai-codex',
            groupId: 'team',
            activeProfileId: 'primary',
            fallbackProfileId: 'backup',
            generation: 4,
          }]),
        },
        runtimeAccountIdentitySelections: [{
          serviceId: 'openai-codex',
          profileId: 'primary',
          groupId: 'team',
          groupGeneration: 4,
          source: 'spawn_selection',
          record: buildConnectedServiceCredentialRecord({
            now,
            serviceId: 'openai-codex',
            profileId: 'primary',
            kind: 'oauth',
            expiresAt: now + 60_000,
            oauth: {
              accessToken: 'access',
              refreshToken: 'refresh',
              idToken: null,
              scope: null,
              tokenType: null,
              providerAccountId,
              providerEmail: `${sessionId}@example.com`,
            },
          }),
        }],
      } as Parameters<ConnectedServiceQuotasCoordinator['registerSpawnTarget']>[0] & {
        runtimeAccountIdentitySelections: ReadonlyArray<unknown>;
      });
    };

    registerGroupSession('source', 501, 'acct-a');
    registerGroupSession('same-account', 502, 'acct-a');
    registerGroupSession('different-account', 503, 'acct-b');

    await expect(coordinator.recordAccountExhaustionAndFanout({
      sourceSessionId: 'source',
      serviceId: 'openai-codex',
      groupId: 'team',
      exhaustedProfileId: 'primary',
      providerAccountId: 'acct-a',
      resetAtMs: null,
      reason: 'usage_limit',
    })).resolves.toEqual({
      status: 'recorded',
      fanoutCandidates: 1,
      fanoutRequests: 1,
    });

    expect(switchBeforeTurn).toHaveBeenCalledTimes(1);
    expect(switchBeforeTurn).toHaveBeenCalledWith({
      sessionId: 'same-account',
      serviceId: 'openai-codex',
      groupId: 'team',
      reason: 'same_provider_account_exhausted',
      observedProfileId: 'primary',
    });
  });

  it('keeps exact hot-apply runtime identity authoritative when a group session spawn env still names the previous profile', async () => {
    const now = 1_000_000;
    const credentials: Credentials = {
      token: 'happy-token',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(9) },
    };
    const api = {
      getAccountEncryptionMode: vi.fn(async () => 'plain' as const),
      getConnectedServiceQuotaSnapshotPlain: vi.fn(async () => null),
      getConnectedServiceCredentialPlain: vi.fn(async () => null),
      registerConnectedServiceQuotaSnapshotPlain: vi.fn(async () => {}),
      getConnectedServiceQuotaSnapshotSealed: vi.fn(async () => null),
      getConnectedServiceCredentialSealed: vi.fn(async () => null),
      registerConnectedServiceQuotaSnapshotSealed: vi.fn(async () => {}),
    } as unknown as QuotaApi;
    const switchBeforeTurn = vi.fn(async () => ({ status: 'switched' as const, activeProfileId: 'backup', generation: 6 }));
    const coordinator = new ConnectedServiceQuotasCoordinator({
      api,
      credentials,
      quotaFetchers: [],
      now: () => now,
      randomBytes: (length: number) => randomBytes(length),
      authGroupSwitchCoordinator: { switchBeforeTurn },
      groupSwitchCheckMinIntervalMs: 0,
      sameAccountFanoutStrategyResolver: () => 'provider_account_id',
    });
    const registerGroupSession = (input: Readonly<{
      sessionId: string;
      pid: number;
      runtimeProfileId?: string;
      providerAccountId?: string;
    }>) => {
      coordinator.registerSpawnTarget({
        pid: input.pid,
        sessionId: input.sessionId,
        connectedServicesBindingsRaw: {
          v: 1,
          bindingsByServiceId: {
            'openai-codex': {
              source: 'connected',
              selection: 'group',
              groupId: 'team',
            },
          },
        },
        connectedServiceSelectionsEnv: {
          [HAPPIER_CONNECTED_SERVICE_SELECTIONS_ENV_KEY]: JSON.stringify([{
            kind: 'group',
            serviceId: 'openai-codex',
            groupId: 'team',
            activeProfileId: 'stale-profile',
            fallbackProfileId: 'backup',
            generation: 4,
          }]),
        },
        ...(input.runtimeProfileId && input.providerAccountId
          ? {
              runtimeAccountIdentitySelections: [{
                serviceId: 'openai-codex',
                profileId: input.runtimeProfileId,
                groupId: 'team',
                groupGeneration: 4,
                source: 'codex_live_auth_apply',
                record: buildConnectedServiceCredentialRecord({
                  now,
                  serviceId: 'openai-codex',
                  profileId: input.runtimeProfileId,
                  kind: 'oauth',
                  expiresAt: now + 60_000,
                  oauth: {
                    accessToken: 'access',
                    refreshToken: 'refresh',
                    idToken: null,
                    scope: null,
                    tokenType: null,
                    providerAccountId: input.providerAccountId,
                    providerEmail: `${input.sessionId}@example.com`,
                  },
                }),
              }],
            }
          : {}),
      } as Parameters<ConnectedServiceQuotasCoordinator['registerSpawnTarget']>[0] & {
        runtimeAccountIdentitySelections?: ReadonlyArray<unknown>;
      });
    };

    registerGroupSession({ sessionId: 'source', pid: 531 });
    registerGroupSession({
      sessionId: 'same-account',
      pid: 532,
      runtimeProfileId: 'runtime-current',
      providerAccountId: 'acct-a',
    });

    await expect(coordinator.recordAccountExhaustionAndFanout({
      sourceSessionId: 'source',
      serviceId: 'openai-codex',
      groupId: 'team',
      exhaustedProfileId: 'stale-profile',
      providerAccountId: 'acct-a',
      resetAtMs: null,
      reason: 'usage_limit',
    })).resolves.toEqual({
      status: 'recorded',
      fanoutCandidates: 1,
      fanoutRequests: 1,
    });

    expect(switchBeforeTurn).toHaveBeenCalledTimes(1);
    expect(switchBeforeTurn).toHaveBeenCalledWith({
      sessionId: 'same-account',
      serviceId: 'openai-codex',
      groupId: 'team',
      reason: 'same_provider_account_exhausted',
      observedProfileId: 'runtime-current',
    });
  });

  it('fails closed when provisional spawn identity cannot be re-proven by live runtime identity', async () => {
    const now = 1_000_000;
    const credentials: Credentials = {
      token: 'happy-token',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(9) },
    };
    const api = {
      getAccountEncryptionMode: vi.fn(async () => 'plain' as const),
      getConnectedServiceQuotaSnapshotPlain: vi.fn(async () => null),
      getConnectedServiceCredentialPlain: vi.fn(async () => null),
      registerConnectedServiceQuotaSnapshotPlain: vi.fn(async () => {}),
      getConnectedServiceQuotaSnapshotSealed: vi.fn(async () => null),
      getConnectedServiceCredentialSealed: vi.fn(async () => null),
      registerConnectedServiceQuotaSnapshotSealed: vi.fn(async () => {}),
    } as unknown as QuotaApi;
    const switchBeforeTurn = vi.fn(async () => ({ status: 'switched' as const, activeProfileId: 'backup', generation: 5 }));
    const readRuntimeAccountIdentity = vi.fn(async () => ({
      status: 'unavailable' as const,
      reason: 'runtime_state_unavailable',
    }));
    const coordinator = new ConnectedServiceQuotasCoordinator({
      api,
      credentials,
      quotaFetchers: [],
      now: () => now,
      randomBytes: (length: number) => randomBytes(length),
      authGroupSwitchCoordinator: { switchBeforeTurn },
      groupSwitchCheckMinIntervalMs: 0,
      sameAccountFanoutStrategyResolver: () => 'provider_account_id',
      readRuntimeAccountIdentity,
    });
    const registerProvisionalGroupSession = (sessionId: string, pid: number, providerAccountId: string) => {
      coordinator.registerSpawnTarget({
        pid,
        sessionId: `spawn-${sessionId}`,
        connectedServicesBindingsRaw: {
          v: 1,
          bindingsByServiceId: {
            'openai-codex': {
              source: 'connected',
              selection: 'group',
              groupId: 'team',
            },
          },
        },
        connectedServiceSelectionsEnv: {
          [HAPPIER_CONNECTED_SERVICE_SELECTIONS_ENV_KEY]: JSON.stringify([{
            kind: 'group',
            serviceId: 'openai-codex',
            groupId: 'team',
            activeProfileId: 'primary',
            fallbackProfileId: 'backup',
            generation: 4,
          }]),
        },
        runtimeAccountIdentitySelections: [{
          serviceId: 'openai-codex',
          profileId: 'primary',
          groupId: 'team',
          groupGeneration: 4,
          source: 'spawn_selection',
          record: buildConnectedServiceCredentialRecord({
            now,
            serviceId: 'openai-codex',
            profileId: 'primary',
            kind: 'oauth',
            expiresAt: now + 60_000,
            oauth: {
              accessToken: 'access',
              refreshToken: 'refresh',
              idToken: null,
              scope: null,
              tokenType: null,
              providerAccountId,
              providerEmail: `${sessionId}@example.com`,
            },
          }),
        }],
      } as Parameters<ConnectedServiceQuotasCoordinator['registerSpawnTarget']>[0] & {
        runtimeAccountIdentitySelections: ReadonlyArray<unknown>;
      });
      coordinator.updateSpawnTargetSessionId({ pid, sessionId });
    };

    registerProvisionalGroupSession('source', 511, 'acct-a');
    registerProvisionalGroupSession('same-account', 512, 'acct-a');

    await expect(coordinator.recordAccountExhaustionAndFanout({
      sourceSessionId: 'source',
      serviceId: 'openai-codex',
      groupId: 'team',
      exhaustedProfileId: 'primary',
      providerAccountId: 'acct-a',
      resetAtMs: null,
      reason: 'usage_limit',
    })).resolves.toEqual({
      status: 'recorded',
      fanoutCandidates: 0,
      fanoutRequests: 0,
    });

    expect(readRuntimeAccountIdentity).toHaveBeenCalledWith({
      sessionId: 'same-account',
      serviceId: 'openai-codex',
      groupId: 'team',
      profileId: 'primary',
      expectedGroupGeneration: 4,
    });
    expect(switchBeforeTurn).not.toHaveBeenCalled();
  });

  it('suppresses warmed same-account fanout when live runtime proof throws, is inexact, or mismatches', async () => {
    const cases = [
      {
        name: 'throws',
        read: async () => {
          throw new Error('runtime identity unavailable');
        },
      },
      {
        name: 'inexact',
        read: async () => ({
          status: 'inexact' as const,
          reason: 'label_only',
          runtime: { inProviderTurn: false, safeToApply: true },
        }),
      },
      {
        name: 'mismatch',
        read: async () => ({
          status: 'verified' as const,
          providerAccountId: 'acct-b',
          proofStrength: 'exact' as const,
          source: 'runtime_identity_probe' as const,
        }),
      },
    ] as const;

    for (const testCase of cases) {
      const now = 1_000_000;
      const credentials: Credentials = {
        token: 'happy-token',
        encryption: { type: 'legacy', secret: new Uint8Array(32).fill(9) },
      };
      const api = {
        getAccountEncryptionMode: vi.fn(async () => 'plain' as const),
        getConnectedServiceQuotaSnapshotPlain: vi.fn(async () => null),
        getConnectedServiceCredentialPlain: vi.fn(async () => null),
        registerConnectedServiceQuotaSnapshotPlain: vi.fn(async () => {}),
        getConnectedServiceQuotaSnapshotSealed: vi.fn(async () => null),
        getConnectedServiceCredentialSealed: vi.fn(async () => null),
        registerConnectedServiceQuotaSnapshotSealed: vi.fn(async () => {}),
      } as unknown as QuotaApi;
      const switchBeforeTurn = vi.fn(async () => ({ status: 'switched' as const, activeProfileId: 'backup', generation: 5 }));
      const readRuntimeAccountIdentity = vi.fn(testCase.read);
      const coordinator = new ConnectedServiceQuotasCoordinator({
        api,
        credentials,
        quotaFetchers: [],
        now: () => now,
        randomBytes: (length: number) => randomBytes(length),
        authGroupSwitchCoordinator: { switchBeforeTurn },
        groupSwitchCheckMinIntervalMs: 0,
        sameAccountFanoutStrategyResolver: () => 'provider_account_id',
        readRuntimeAccountIdentity,
      });
      for (const [sessionId, pid] of [['source', 521], ['same-account', 522]] as const) {
        coordinator.registerSpawnTarget({
          pid,
          sessionId: `${testCase.name}-${sessionId}`,
          connectedServicesBindingsRaw: {
            v: 1,
            bindingsByServiceId: {
              'openai-codex': {
                source: 'connected',
                selection: 'group',
                groupId: 'team',
              },
            },
          },
          connectedServiceSelectionsEnv: {
            [HAPPIER_CONNECTED_SERVICE_SELECTIONS_ENV_KEY]: JSON.stringify([{
              kind: 'group',
              serviceId: 'openai-codex',
              groupId: 'team',
              activeProfileId: 'primary',
              fallbackProfileId: 'backup',
              generation: 4,
            }]),
          },
        });
      }
      coordinator.recordRuntimeAccountIdentityFromSnapshot({
        sessionId: `${testCase.name}-same-account`,
        serviceId: 'openai-codex',
        groupId: 'team',
        profileId: 'primary',
        providerAccountId: 'acct-a',
        accountLabel: null,
        observedAtMs: now,
        source: 'active_account_verification',
        proofStrength: 'exact',
        groupGeneration: 4,
      });

      await expect(coordinator.recordAccountExhaustionAndFanout({
        sourceSessionId: `${testCase.name}-source`,
        serviceId: 'openai-codex',
        groupId: 'team',
        exhaustedProfileId: 'primary',
        providerAccountId: 'acct-a',
        resetAtMs: null,
        reason: 'usage_limit',
      })).resolves.toEqual({
        status: 'recorded',
        fanoutCandidates: 0,
        fanoutRequests: 0,
      });

      expect(readRuntimeAccountIdentity).toHaveBeenCalledWith({
        sessionId: `${testCase.name}-same-account`,
        serviceId: 'openai-codex',
        groupId: 'team',
        profileId: 'primary',
        expectedGroupGeneration: 4,
      });
      expect(switchBeforeTurn).not.toHaveBeenCalled();
    }
  });

  it('reconciles cold active same-group siblings through runtime identity before declaring no fanout target', async () => {
    const now = 1_000_000;
    const credentials: Credentials = {
      token: 'happy-token',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(9) },
    };
    const api = {
      getAccountEncryptionMode: vi.fn(async () => 'plain' as const),
      getConnectedServiceQuotaSnapshotPlain: vi.fn(async () => null),
      getConnectedServiceCredentialPlain: vi.fn(async () => null),
      registerConnectedServiceQuotaSnapshotPlain: vi.fn(async () => {}),
      getConnectedServiceQuotaSnapshotSealed: vi.fn(async () => null),
      getConnectedServiceCredentialSealed: vi.fn(async () => null),
      registerConnectedServiceQuotaSnapshotSealed: vi.fn(async () => {}),
    } as unknown as QuotaApi;
    const switchBeforeTurn = vi.fn(async () => ({ status: 'switched' as const, activeProfileId: 'backup', generation: 5 }));
    const readRuntimeAccountIdentity = vi.fn(async ({ sessionId }: { sessionId: string }) => {
      if (sessionId === 'same-account') {
        return {
          status: 'verified' as const,
          providerAccountId: 'acct-a',
          accountLabel: 'same@example.com',
          proofStrength: 'exact' as const,
          source: 'runtime_identity_probe' as const,
          runtime: {
            inProviderTurn: true,
            safeToApply: false,
          },
        };
      }
      return {
        status: 'verified' as const,
        providerAccountId: 'acct-b',
        accountLabel: 'different@example.com',
        proofStrength: 'exact' as const,
        source: 'runtime_identity_probe' as const,
      };
    });
    const diagnostics: unknown[] = [];
    const coordinatorParams = {
      api,
      credentials,
      quotaFetchers: [],
      now: () => now,
      randomBytes: (length: number) => randomBytes(length),
      authGroupSwitchCoordinator: { switchBeforeTurn },
      groupSwitchCheckMinIntervalMs: 0,
      sameAccountFanoutStrategyResolver: () => 'provider_account_id' as const,
      runtimeAuthApplyCapabilityResolver: () => ({
        directLiveHotAuth: directLiveExternalTokenInjectionCapability.directLiveHotAuth,
      }),
      readRuntimeAccountIdentity,
      recordDiagnostic: (event: unknown) => diagnostics.push(event),
    } satisfies ConstructorParameters<typeof ConnectedServiceQuotasCoordinator>[0] & {
      readRuntimeAccountIdentity: typeof readRuntimeAccountIdentity;
    };
    const coordinator = new ConnectedServiceQuotasCoordinator(coordinatorParams);
    for (const [sessionId, pid] of [['source', 511], ['same-account', 512], ['different-account', 513]] as const) {
      coordinator.registerSpawnTarget({
        pid,
        sessionId,
        connectedServicesBindingsRaw: {
          v: 1,
          bindingsByServiceId: {
            'openai-codex': {
              source: 'connected',
              selection: 'group',
              groupId: 'team',
            },
          },
        },
        connectedServiceSelectionsEnv: {
          [HAPPIER_CONNECTED_SERVICE_SELECTIONS_ENV_KEY]: JSON.stringify([{
            kind: 'group',
            serviceId: 'openai-codex',
            groupId: 'team',
            activeProfileId: 'primary',
            fallbackProfileId: 'backup',
            generation: 4,
          }]),
        },
      });
    }

    await expect(coordinator.recordAccountExhaustionAndFanout({
      sourceSessionId: 'source',
      serviceId: 'openai-codex',
      groupId: 'team',
      exhaustedProfileId: 'primary',
      providerAccountId: 'acct-a',
      resetAtMs: null,
      reason: 'usage_limit',
    })).resolves.toEqual({
      status: 'recorded',
      fanoutCandidates: 1,
      fanoutRequests: 1,
    });

    expect(readRuntimeAccountIdentity).toHaveBeenCalledTimes(2);
    expect(readRuntimeAccountIdentity).toHaveBeenCalledWith({
      sessionId: 'same-account',
      serviceId: 'openai-codex',
      groupId: 'team',
      profileId: 'primary',
      expectedGroupGeneration: 4,
    });
    expect(switchBeforeTurn).toHaveBeenCalledWith({
      sessionId: 'same-account',
      serviceId: 'openai-codex',
      groupId: 'team',
      reason: 'same_provider_account_exhausted',
      observedProfileId: 'primary',
    });
    expect(diagnostics).toContainEqual(expect.objectContaining({
      event: 'quota_work_suppressed',
      phase: 'same_account_fanout',
      reason: 'same_account_fanout_identity_index_cold',
    }));
    expect(diagnostics).not.toContainEqual(expect.objectContaining({
      event: 'quota_work_deferred',
      phase: 'same_account_fanout',
      reason: 'same_account_fanout_candidate_deferred_until_turn_boundary',
    }));
  });

  it('repairs stale expected profile and generation from exact runtime identity before fanout', async () => {
    const now = 1_000_000;
    const credentials: Credentials = {
      token: 'happy-token',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(9) },
    };
    const api = {
      getAccountEncryptionMode: vi.fn(async () => 'plain' as const),
      getConnectedServiceQuotaSnapshotPlain: vi.fn(async () => null),
      getConnectedServiceCredentialPlain: vi.fn(async () => null),
      registerConnectedServiceQuotaSnapshotPlain: vi.fn(async () => {}),
      getConnectedServiceQuotaSnapshotSealed: vi.fn(async () => null),
      getConnectedServiceCredentialSealed: vi.fn(async () => null),
      registerConnectedServiceQuotaSnapshotSealed: vi.fn(async () => {}),
    } as unknown as QuotaApi;
    const switchBeforeTurn = vi.fn(async () => ({ status: 'switched' as const, activeProfileId: 'backup', generation: 338 }));
    const readRuntimeAccountIdentity = vi.fn(async () => ({
      status: 'verified' as const,
      strategy: 'provider_account_id' as const,
      providerAccountId: 'acct-a',
      accountLabel: 'same@example.com',
      proofStrength: 'exact' as const,
      source: 'runtime_identity_probe' as const,
      profileId: 'runtime-current',
      groupId: 'team',
      groupGeneration: 337,
      runtime: {
        inProviderTurn: true,
        safeToApply: false,
      },
    }));
    const diagnostics: unknown[] = [];
    const coordinator = new ConnectedServiceQuotasCoordinator({
      api,
      credentials,
      quotaFetchers: [],
      now: () => now,
      randomBytes: (length: number) => randomBytes(length),
      authGroupSwitchCoordinator: { switchBeforeTurn },
      groupSwitchCheckMinIntervalMs: 0,
      sameAccountFanoutStrategyResolver: () => 'provider_account_id',
      runtimeAuthApplyCapabilityResolver: () => ({
        directLiveHotAuth: directLiveExternalTokenInjectionCapability.directLiveHotAuth,
      }),
      readRuntimeAccountIdentity,
      recordDiagnostic: (event) => diagnostics.push(event),
    });
    for (const [sessionId, pid] of [['source', 541], ['same-account', 542]] as const) {
      coordinator.registerSpawnTarget({
        pid,
        sessionId,
        connectedServicesBindingsRaw: {
          v: 1,
          bindingsByServiceId: {
            'openai-codex': {
              source: 'connected',
              selection: 'group',
              groupId: 'team',
            },
          },
        },
        connectedServiceSelectionsEnv: {
          [HAPPIER_CONNECTED_SERVICE_SELECTIONS_ENV_KEY]: JSON.stringify([{
            kind: 'group',
            serviceId: 'openai-codex',
            groupId: 'team',
            activeProfileId: 'stale-daemon-profile',
            fallbackProfileId: 'backup',
            generation: 4,
          }]),
        },
      });
    }

    await expect(coordinator.recordAccountExhaustionAndFanout({
      sourceSessionId: 'source',
      serviceId: 'openai-codex',
      groupId: 'team',
      exhaustedProfileId: 'stale-daemon-profile',
      providerAccountId: 'acct-a',
      resetAtMs: null,
      reason: 'usage_limit',
    })).resolves.toEqual({
      status: 'recorded',
      fanoutCandidates: 1,
      fanoutRequests: 1,
    });

    expect(readRuntimeAccountIdentity).toHaveBeenCalledWith({
      sessionId: 'same-account',
      serviceId: 'openai-codex',
      groupId: 'team',
      profileId: 'stale-daemon-profile',
      expectedGroupGeneration: 4,
    });
    expect(switchBeforeTurn).toHaveBeenCalledWith({
      sessionId: 'same-account',
      serviceId: 'openai-codex',
      groupId: 'team',
      reason: 'same_provider_account_exhausted',
      observedProfileId: 'runtime-current',
    });
    expect(diagnostics).toContainEqual(expect.objectContaining({
      event: 'quota_work_suppressed',
      phase: 'same_account_fanout',
      reason: 'runtime_identity_probe_stale_expected_state_reconciled',
    }));
  });

  it('suppresses stale expected-state candidates when exact runtime account identity mismatches', async () => {
    const now = 1_000_000;
    const credentials: Credentials = {
      token: 'happy-token',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(9) },
    };
    const api = {
      getAccountEncryptionMode: vi.fn(async () => 'plain' as const),
      getConnectedServiceQuotaSnapshotPlain: vi.fn(async () => null),
      getConnectedServiceCredentialPlain: vi.fn(async () => null),
      registerConnectedServiceQuotaSnapshotPlain: vi.fn(async () => {}),
      getConnectedServiceQuotaSnapshotSealed: vi.fn(async () => null),
      getConnectedServiceCredentialSealed: vi.fn(async () => null),
      registerConnectedServiceQuotaSnapshotSealed: vi.fn(async () => {}),
    } as unknown as QuotaApi;
    const switchBeforeTurn = vi.fn(async () => ({ status: 'switched' as const, activeProfileId: 'backup', generation: 338 }));
    const readRuntimeAccountIdentity = vi.fn(async () => ({
      status: 'verified' as const,
      strategy: 'provider_account_id' as const,
      providerAccountId: 'acct-b',
      proofStrength: 'exact' as const,
      source: 'runtime_identity_probe' as const,
      profileId: 'runtime-current',
      groupId: 'team',
      groupGeneration: 337,
    }));
    const diagnostics: unknown[] = [];
    const coordinator = new ConnectedServiceQuotasCoordinator({
      api,
      credentials,
      quotaFetchers: [],
      now: () => now,
      randomBytes: (length: number) => randomBytes(length),
      authGroupSwitchCoordinator: { switchBeforeTurn },
      groupSwitchCheckMinIntervalMs: 0,
      sameAccountFanoutStrategyResolver: () => 'provider_account_id',
      readRuntimeAccountIdentity,
      recordDiagnostic: (event) => diagnostics.push(event),
    });
    for (const [sessionId, pid] of [['source', 551], ['same-account', 552]] as const) {
      coordinator.registerSpawnTarget({
        pid,
        sessionId,
        connectedServicesBindingsRaw: {
          v: 1,
          bindingsByServiceId: {
            'openai-codex': {
              source: 'connected',
              selection: 'group',
              groupId: 'team',
            },
          },
        },
        connectedServiceSelectionsEnv: {
          [HAPPIER_CONNECTED_SERVICE_SELECTIONS_ENV_KEY]: JSON.stringify([{
            kind: 'group',
            serviceId: 'openai-codex',
            groupId: 'team',
            activeProfileId: 'stale-daemon-profile',
            fallbackProfileId: 'backup',
            generation: 4,
          }]),
        },
      });
    }

    await expect(coordinator.recordAccountExhaustionAndFanout({
      sourceSessionId: 'source',
      serviceId: 'openai-codex',
      groupId: 'team',
      exhaustedProfileId: 'stale-daemon-profile',
      providerAccountId: 'acct-a',
      resetAtMs: null,
      reason: 'usage_limit',
    })).resolves.toEqual({
      status: 'recorded',
      fanoutCandidates: 0,
      fanoutRequests: 0,
    });

    expect(switchBeforeTurn).not.toHaveBeenCalled();
    expect(diagnostics).toContainEqual(expect.objectContaining({
      event: 'quota_work_suppressed',
      phase: 'same_account_fanout',
      reason: 'runtime_identity_probe_account_mismatch',
    }));
    expect(diagnostics).not.toContainEqual(expect.objectContaining({
      event: 'quota_work_suppressed',
      phase: 'same_account_fanout',
      reason: 'same_account_fanout_no_matching_sessions',
    }));
  });

  it('reconciles shared group auth-surface siblings without provider account ids', async () => {
    const now = 1_000_000;
    const credentials: Credentials = {
      token: 'happy-token',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(9) },
    };
    const api = {
      getAccountEncryptionMode: vi.fn(async () => 'plain' as const),
      getConnectedServiceQuotaSnapshotPlain: vi.fn(async () => null),
      getConnectedServiceCredentialPlain: vi.fn(async () => null),
      registerConnectedServiceQuotaSnapshotPlain: vi.fn(async () => {}),
      getConnectedServiceQuotaSnapshotSealed: vi.fn(async () => null),
      getConnectedServiceCredentialSealed: vi.fn(async () => null),
      registerConnectedServiceQuotaSnapshotSealed: vi.fn(async () => {}),
    } as unknown as QuotaApi;
    const switchBeforeTurn = vi.fn(async () => ({ status: 'switched' as const, activeProfileId: 'backup', generation: 9 }));
    const readRuntimeAccountIdentity = vi.fn(async () => ({
      status: 'verified' as const,
      strategy: 'shared_group_auth_surface' as const,
      sharedAuthSurfaceId: 'team',
      accountLabel: 'shared team auth',
      proofStrength: 'exact' as const,
      source: 'runtime_identity_probe' as const,
      profileId: 'runtime-current',
      groupId: 'team',
      groupGeneration: 8,
    }));
    const coordinator = new ConnectedServiceQuotasCoordinator({
      api,
      credentials,
      quotaFetchers: [],
      now: () => now,
      randomBytes: (length: number) => randomBytes(length),
      authGroupSwitchCoordinator: { switchBeforeTurn },
      groupSwitchCheckMinIntervalMs: 0,
      sameAccountFanoutStrategyResolver: () => 'shared_group_auth_surface',
      readRuntimeAccountIdentity,
    });
    for (const [sessionId, pid] of [['source', 561], ['shared-sibling', 562]] as const) {
      coordinator.registerSpawnTarget({
        pid,
        sessionId,
        connectedServicesBindingsRaw: {
          v: 1,
          bindingsByServiceId: {
            'claude-subscription': {
              source: 'connected',
              selection: 'group',
              groupId: 'team',
            },
          },
        },
        connectedServiceSelectionsEnv: {
          [HAPPIER_CONNECTED_SERVICE_SELECTIONS_ENV_KEY]: JSON.stringify([{
            kind: 'group',
            serviceId: 'claude-subscription',
            groupId: 'team',
            activeProfileId: 'stale-daemon-profile',
            fallbackProfileId: 'backup',
            generation: 4,
          }]),
        },
      });
    }

    await expect(coordinator.recordAccountExhaustionAndFanout({
      sourceSessionId: 'source',
      serviceId: 'claude-subscription',
      groupId: 'team',
      exhaustedProfileId: 'stale-daemon-profile',
      providerAccountId: '',
      resetAtMs: null,
      reason: 'usage_limit',
    })).resolves.toEqual({
      status: 'recorded',
      fanoutCandidates: 1,
      fanoutRequests: 1,
    });

    expect(switchBeforeTurn).toHaveBeenCalledWith({
      sessionId: 'shared-sibling',
      serviceId: 'claude-subscription',
      groupId: 'team',
      reason: 'same_provider_account_exhausted',
      observedProfileId: 'runtime-current',
    });
  });

  it('diagnoses group-wide exhaustion and applies fanout after target eligibility recovers', async () => {
    let now = 1_000_000;
    const resetAtMs = now + 600_000;
    const runtimeQuotaSnapshots = new ConnectedServiceAuthGroupRuntimeQuotaSnapshotStore();
    const credentials: Credentials = {
      token: 'happy-token',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(9) },
    };
    const memberStates = new Map<string, Record<string, unknown>>([
      ['primary', {
        quotaExhaustedUntilMs: resetAtMs,
        lastFailureKind: 'usage_limit',
        lastObservedAtMs: now - 1_000,
        providerResetsAtMs: resetAtMs,
      }],
      ['backup', {
        quotaExhaustedUntilMs: resetAtMs,
        lastFailureKind: 'usage_limit',
        lastObservedAtMs: now - 1_000,
        providerResetsAtMs: resetAtMs,
      }],
    ]);
    const buildGroup = () => ({
      v: 1,
      serviceId: 'openai-codex',
      groupId: 'team',
      displayName: 'Team',
      activeProfileId: 'primary',
      generation: 4,
      policy: {
        v: 1,
        autoSwitch: true,
        strategy: 'priority',
        cooldownMs: 500,
      },
      state: { v: 1 },
      members: ['primary', 'backup'].map((profileId, index) => ({
        v: 1,
        serviceId: 'openai-codex',
        groupId: 'team',
        profileId,
        priority: index,
        enabled: true,
        state: memberStates.get(profileId) ?? {},
        createdAt: index + 1,
        updatedAt: index + 1,
      })),
      createdAt: 1,
      updatedAt: 2,
    });
    const api = {
      getAccountEncryptionMode: vi.fn(async () => 'plain' as const),
      getConnectedServiceQuotaSnapshotPlain: vi.fn(async () => null),
      getConnectedServiceCredentialPlain: vi.fn(async () => null),
      registerConnectedServiceQuotaSnapshotPlain: vi.fn(async () => {}),
      getConnectedServiceQuotaSnapshotSealed: vi.fn(async () => null),
      getConnectedServiceCredentialSealed: vi.fn(async () => null),
      registerConnectedServiceQuotaSnapshotSealed: vi.fn(async () => {}),
      getConnectedServiceAuthGroup: vi.fn(async () => buildGroup()),
    } as unknown as QuotaApi;
    const switchBeforeTurn = vi.fn(async () => ({ status: 'switched' as const, activeProfileId: 'backup', generation: 5 }));
    const readRuntimeAccountIdentity = vi.fn(async () => ({
      status: 'verified' as const,
      strategy: 'provider_account_id' as const,
      providerAccountId: 'acct-a',
      proofStrength: 'exact' as const,
      source: 'runtime_identity_probe' as const,
      profileId: 'primary',
      groupId: 'team',
      groupGeneration: 4,
    }));
    const diagnostics: unknown[] = [];
    const coordinator = new ConnectedServiceQuotasCoordinator({
      api,
      credentials,
      quotaFetchers: [],
      now: () => now,
      randomBytes: (length: number) => randomBytes(length),
      runtimeQuotaSnapshots,
      authGroupSwitchCoordinator: { switchBeforeTurn },
      sameAccountFanoutMinIntervalMs: 0,
      sameAccountFanoutStrategyResolver: () => 'provider_account_id',
      readRuntimeAccountIdentity,
      recordDiagnostic: (event) => diagnostics.push(event),
    });
    for (const [sessionId, pid] of [['source', 571], ['same-account', 572]] as const) {
      coordinator.registerSpawnTarget({
        pid,
        sessionId,
        connectedServicesBindingsRaw: {
          v: 1,
          bindingsByServiceId: {
            'openai-codex': {
              source: 'connected',
              selection: 'group',
              groupId: 'team',
            },
          },
        },
        connectedServiceSelectionsEnv: {
          [HAPPIER_CONNECTED_SERVICE_SELECTIONS_ENV_KEY]: JSON.stringify([{
            kind: 'group',
            serviceId: 'openai-codex',
            groupId: 'team',
            activeProfileId: 'primary',
            fallbackProfileId: 'backup',
            generation: 4,
          }]),
        },
      });
    }
    coordinator.recordRuntimeAccountIdentityFromSnapshot({
      sessionId: 'same-account',
      serviceId: 'openai-codex',
      groupId: 'team',
      profileId: 'primary',
      providerAccountId: 'acct-a',
      accountLabel: null,
      observedAtMs: now,
      source: 'active_account_verification',
      proofStrength: 'exact',
      groupGeneration: 4,
    });

    await expect(coordinator.recordAccountExhaustionAndFanout({
      sourceSessionId: 'source',
      serviceId: 'openai-codex',
      groupId: 'team',
      exhaustedProfileId: 'primary',
      providerAccountId: 'acct-a',
      resetAtMs,
      reason: 'usage_limit',
    })).resolves.toEqual({
      status: 'recorded',
      fanoutCandidates: 1,
      fanoutRequests: 0,
    });
    expect(switchBeforeTurn).not.toHaveBeenCalled();
    expect(diagnostics).toContainEqual(expect.objectContaining({
      event: 'quota_work_suppressed',
      phase: 'same_account_fanout',
      reason: 'group_exhausted_no_eligible_target',
      retryAfterMs: resetAtMs - now,
    }));
    expect(diagnostics).not.toContainEqual(expect.objectContaining({
      event: 'quota_work_suppressed',
      phase: 'same_account_fanout',
      reason: 'same_account_fanout_no_matching_sessions',
    }));

    now = resetAtMs + 1;
    memberStates.set('backup', {});

    await expect(coordinator.recordAccountExhaustionAndFanout({
      sourceSessionId: 'source',
      serviceId: 'openai-codex',
      groupId: 'team',
      exhaustedProfileId: 'primary',
      providerAccountId: 'acct-a',
      resetAtMs: null,
      reason: 'usage_limit',
    })).resolves.toEqual({
      status: 'recorded',
      fanoutCandidates: 1,
      fanoutRequests: 1,
    });
    expect(switchBeforeTurn).toHaveBeenCalledTimes(1);
  });

  it('suppresses same-account exhaustion fanout unless the provider strategy opts into exact account proof', async () => {
    const now = 1_000_000;
    const credentials: Credentials = {
      token: 'happy-token',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(9) },
    };
    const api = {
      getAccountEncryptionMode: vi.fn(async () => 'plain' as const),
      getConnectedServiceQuotaSnapshotPlain: vi.fn(async () => null),
      getConnectedServiceCredentialPlain: vi.fn(async () => null),
      registerConnectedServiceQuotaSnapshotPlain: vi.fn(async () => {}),
      getConnectedServiceQuotaSnapshotSealed: vi.fn(async () => null),
      getConnectedServiceCredentialSealed: vi.fn(async () => null),
      registerConnectedServiceQuotaSnapshotSealed: vi.fn(async () => {}),
    } as unknown as QuotaApi;
    const switchBeforeTurn = vi.fn(async () => ({ status: 'switched' as const, activeProfileId: 'backup', generation: 2 }));
    const coordinator = new ConnectedServiceQuotasCoordinator({
      api,
      credentials,
      quotaFetchers: [],
      now: () => now,
      randomBytes: (length: number) => randomBytes(length),
      authGroupSwitchCoordinator: { switchBeforeTurn },
      groupSwitchCheckMinIntervalMs: 0,
    });
    for (const [sessionId, pid] of [['source', 111], ['same-account', 112]] as const) {
      coordinator.registerSpawnTarget({
        pid,
        sessionId,
        connectedServicesBindingsRaw: {
          v: 1,
          bindingsByServiceId: {
            'openai-codex': {
              source: 'connected',
              selection: 'group',
              groupId: 'team',
            },
          },
        },
        connectedServiceSelectionsEnv: {
          [HAPPIER_CONNECTED_SERVICE_SELECTIONS_ENV_KEY]: JSON.stringify([{
            kind: 'group',
            serviceId: 'openai-codex',
            groupId: 'team',
            activeProfileId: 'primary',
            fallbackProfileId: 'backup',
            generation: 4,
          }]),
        },
      });
      coordinator.recordRuntimeAccountIdentityFromSnapshot({
        sessionId,
        serviceId: 'openai-codex',
        groupId: 'team',
        profileId: 'primary',
        providerAccountId: 'acct-a',
        accountLabel: null,
        observedAtMs: now,
        source: 'active_account_verification',
        proofStrength: 'exact',
        groupGeneration: 4,
      });
    }

    await expect(coordinator.recordAccountExhaustionAndFanout({
      sourceSessionId: 'source',
      serviceId: 'openai-codex',
      groupId: 'team',
      exhaustedProfileId: 'primary',
      providerAccountId: 'acct-a',
      resetAtMs: null,
      reason: 'usage_limit',
    })).resolves.toEqual({
      status: 'recorded',
      fanoutCandidates: 0,
      fanoutRequests: 0,
    });

    expect(switchBeforeTurn).not.toHaveBeenCalled();
  });

  it('invalidates a sibling runtime account identity before same-account fanout so stale proof is not reused', async () => {
    let now = 1_000_000;
    const credentials: Credentials = {
      token: 'happy-token',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(9) },
    };
    const api = {
      getAccountEncryptionMode: vi.fn(async () => 'plain' as const),
      getConnectedServiceQuotaSnapshotPlain: vi.fn(async () => null),
      getConnectedServiceCredentialPlain: vi.fn(async () => null),
      registerConnectedServiceQuotaSnapshotPlain: vi.fn(async () => {}),
      getConnectedServiceQuotaSnapshotSealed: vi.fn(async () => null),
      getConnectedServiceCredentialSealed: vi.fn(async () => null),
      registerConnectedServiceQuotaSnapshotSealed: vi.fn(async () => {}),
    } as unknown as QuotaApi;
    const switchBeforeTurn = vi.fn(async () => ({ status: 'switched' as const, activeProfileId: 'backup', generation: 2 }));
    const coordinator = new ConnectedServiceQuotasCoordinator({
      api,
      credentials,
      quotaFetchers: [],
      now: () => now,
      randomBytes: (length: number) => randomBytes(length),
      authGroupSwitchCoordinator: { switchBeforeTurn },
      sameAccountFanoutMinIntervalMs: 0,
      sameAccountFanoutStrategyResolver: () => 'provider_account_id',
    });
    for (const [sessionId, pid] of [['source', 121], ['same-account', 122]] as const) {
      coordinator.registerSpawnTarget({
        pid,
        sessionId,
        connectedServicesBindingsRaw: {
          v: 1,
          bindingsByServiceId: {
            'openai-codex': {
              source: 'connected',
              selection: 'group',
              groupId: 'team',
            },
          },
        },
        connectedServiceSelectionsEnv: {
          [HAPPIER_CONNECTED_SERVICE_SELECTIONS_ENV_KEY]: JSON.stringify([{
            kind: 'group',
            serviceId: 'openai-codex',
            groupId: 'team',
            activeProfileId: 'primary',
            fallbackProfileId: 'backup',
            generation: 4,
          }]),
        },
      });
    }
    coordinator.recordRuntimeAccountIdentityFromSnapshot({
      sessionId: 'same-account',
      serviceId: 'openai-codex',
      groupId: 'team',
      profileId: 'primary',
      providerAccountId: 'acct-a',
      accountLabel: null,
      observedAtMs: now,
      source: 'runtime_quota_snapshot',
      proofStrength: 'exact',
      groupGeneration: 4,
    });

    await expect(coordinator.recordAccountExhaustionAndFanout({
      sourceSessionId: 'source',
      serviceId: 'openai-codex',
      groupId: 'team',
      exhaustedProfileId: 'primary',
      providerAccountId: 'acct-a',
      resetAtMs: null,
      reason: 'usage_limit',
    })).resolves.toEqual({
      status: 'recorded',
      fanoutCandidates: 1,
      fanoutRequests: 1,
    });

    now += 1_000;
    await expect(coordinator.recordAccountExhaustionAndFanout({
      sourceSessionId: 'source',
      serviceId: 'openai-codex',
      groupId: 'team',
      exhaustedProfileId: 'primary',
      providerAccountId: 'acct-a',
      resetAtMs: null,
      reason: 'usage_limit',
    })).resolves.toEqual({
      status: 'recorded',
      fanoutCandidates: 0,
      fanoutRequests: 0,
    });
    expect(switchBeforeTurn).toHaveBeenCalledTimes(1);
  });

  it('invalidates runtime account identity on pid transfer before same-account fanout', async () => {
    const now = 1_000_000;
    const credentials: Credentials = {
      token: 'happy-token',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(9) },
    };
    const api = {
      getAccountEncryptionMode: vi.fn(async () => 'plain' as const),
      getConnectedServiceQuotaSnapshotPlain: vi.fn(async () => null),
      getConnectedServiceCredentialPlain: vi.fn(async () => null),
      registerConnectedServiceQuotaSnapshotPlain: vi.fn(async () => {}),
      getConnectedServiceQuotaSnapshotSealed: vi.fn(async () => null),
      getConnectedServiceCredentialSealed: vi.fn(async () => null),
      registerConnectedServiceQuotaSnapshotSealed: vi.fn(async () => {}),
    } as unknown as QuotaApi;
    const switchBeforeTurn = vi.fn(async () => ({ status: 'switched' as const, activeProfileId: 'backup', generation: 2 }));
    const coordinator = new ConnectedServiceQuotasCoordinator({
      api,
      credentials,
      quotaFetchers: [],
      now: () => now,
      randomBytes: (length: number) => randomBytes(length),
      authGroupSwitchCoordinator: { switchBeforeTurn },
      sameAccountFanoutMinIntervalMs: 0,
      sameAccountFanoutStrategyResolver: () => 'provider_account_id',
    });
    const registerGroupSession = (sessionId: string, pid: number) => {
      coordinator.registerSpawnTarget({
        pid,
        sessionId,
        connectedServicesBindingsRaw: {
          v: 1,
          bindingsByServiceId: {
            'openai-codex': {
              source: 'connected',
              selection: 'group',
              groupId: 'team',
            },
          },
        },
        connectedServiceSelectionsEnv: {
          [HAPPIER_CONNECTED_SERVICE_SELECTIONS_ENV_KEY]: JSON.stringify([{
            kind: 'group',
            serviceId: 'openai-codex',
            groupId: 'team',
            activeProfileId: 'primary',
            fallbackProfileId: 'backup',
            generation: 4,
          }]),
        },
      });
    };
    registerGroupSession('source', 131);
    registerGroupSession('same-account', 132);
    coordinator.recordRuntimeAccountIdentityFromSnapshot({
      sessionId: 'same-account',
      serviceId: 'openai-codex',
      groupId: 'team',
      profileId: 'primary',
      providerAccountId: 'acct-a',
      accountLabel: null,
      observedAtMs: now,
      source: 'runtime_quota_snapshot',
      proofStrength: 'exact',
      groupGeneration: 4,
    });

    coordinator.transferPid(132, 232);

    await expect(coordinator.recordAccountExhaustionAndFanout({
      sourceSessionId: 'source',
      serviceId: 'openai-codex',
      groupId: 'team',
      exhaustedProfileId: 'primary',
      providerAccountId: 'acct-a',
      resetAtMs: null,
      reason: 'usage_limit',
    })).resolves.toEqual({
      status: 'recorded',
      fanoutCandidates: 0,
      fanoutRequests: 0,
    });

    expect(switchBeforeTurn).not.toHaveBeenCalled();
  });

  it('coalesces duplicate same-account exhaustion fanout for the same provider account and reset bucket', async () => {
    let now = 1_000_000;
    const credentials: Credentials = {
      token: 'happy-token',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(9) },
    };
    const api = {
      getAccountEncryptionMode: vi.fn(async () => 'plain' as const),
      getConnectedServiceQuotaSnapshotPlain: vi.fn(async () => null),
      getConnectedServiceCredentialPlain: vi.fn(async () => null),
      registerConnectedServiceQuotaSnapshotPlain: vi.fn(async () => {}),
      getConnectedServiceQuotaSnapshotSealed: vi.fn(async () => null),
      getConnectedServiceCredentialSealed: vi.fn(async () => null),
      registerConnectedServiceQuotaSnapshotSealed: vi.fn(async () => {}),
    } as unknown as QuotaApi;
    const switchBeforeTurn = vi.fn(async () => ({ status: 'switched' as const, activeProfileId: 'backup', generation: 2 }));
    const diagnostics: unknown[] = [];
    const coordinator = new ConnectedServiceQuotasCoordinator({
      api,
      credentials,
      quotaFetchers: [],
      now: () => now,
      randomBytes: (length: number) => randomBytes(length),
      authGroupSwitchCoordinator: { switchBeforeTurn },
      recordDiagnostic: (event) => diagnostics.push(event),
      sameAccountFanoutMinIntervalMs: 60_000,
      sameAccountFanoutStrategyResolver: () => 'provider_account_id',
    });
    for (const [sessionId, pid] of [['source', 201], ['same-account', 202]] as const) {
      coordinator.registerSpawnTarget({
        pid,
        sessionId,
        connectedServicesBindingsRaw: {
          v: 1,
          bindingsByServiceId: {
            'openai-codex': {
              source: 'connected',
              selection: 'group',
              groupId: 'team',
            },
          },
        },
        connectedServiceSelectionsEnv: {
          [HAPPIER_CONNECTED_SERVICE_SELECTIONS_ENV_KEY]: JSON.stringify([{
            kind: 'group',
            serviceId: 'openai-codex',
            groupId: 'team',
            activeProfileId: 'primary',
            fallbackProfileId: 'backup',
            generation: 4,
          }]),
        },
      });
      coordinator.recordRuntimeAccountIdentityFromSnapshot({
        sessionId,
        serviceId: 'openai-codex',
        groupId: 'team',
        profileId: 'primary',
        providerAccountId: 'acct-a',
        accountLabel: null,
        observedAtMs: now,
        source: 'active_account_verification',
        proofStrength: 'exact',
        groupGeneration: 4,
      });
    }

    await coordinator.recordAccountExhaustionAndFanout({
      sourceSessionId: 'source',
      serviceId: 'openai-codex',
      groupId: 'team',
      exhaustedProfileId: 'primary',
      providerAccountId: 'acct-a',
      resetAtMs: 1_200_000,
      reason: 'usage_limit',
    });
    now += 10_000;
    coordinator.recordRuntimeAccountIdentityFromSnapshot({
      sessionId: 'same-account',
      serviceId: 'openai-codex',
      groupId: 'team',
      profileId: 'primary',
      providerAccountId: 'acct-a',
      accountLabel: null,
      observedAtMs: now,
      source: 'active_account_verification',
      proofStrength: 'exact',
      groupGeneration: 4,
    });
    await expect(coordinator.recordAccountExhaustionAndFanout({
      sourceSessionId: 'source',
      serviceId: 'openai-codex',
      groupId: 'team',
      exhaustedProfileId: 'primary',
      providerAccountId: 'acct-a',
      resetAtMs: 1_200_001,
      reason: 'usage_limit',
    })).resolves.toEqual({
      status: 'recorded',
      fanoutCandidates: 0,
      fanoutRequests: 0,
    });

    expect(switchBeforeTurn).toHaveBeenCalledTimes(1);
    expect(diagnostics).toContainEqual(expect.objectContaining({
      event: 'quota_work_suppressed',
      phase: 'same_account_fanout',
      reason: 'same_provider_account_exhaustion_coalesced',
    }));
  });

  it('does not coalesce a same-account exhaustion fanout until there is a proven sibling candidate', async () => {
    let now = 1_000_000;
    const credentials: Credentials = {
      token: 'happy-token',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(9) },
    };
    const api = {
      getAccountEncryptionMode: vi.fn(async () => 'plain' as const),
      getConnectedServiceQuotaSnapshotPlain: vi.fn(async () => null),
      getConnectedServiceCredentialPlain: vi.fn(async () => null),
      registerConnectedServiceQuotaSnapshotPlain: vi.fn(async () => {}),
      getConnectedServiceQuotaSnapshotSealed: vi.fn(async () => null),
      getConnectedServiceCredentialSealed: vi.fn(async () => null),
      registerConnectedServiceQuotaSnapshotSealed: vi.fn(async () => {}),
    } as unknown as QuotaApi;
    const switchBeforeTurn = vi.fn(async () => ({ status: 'switched' as const, activeProfileId: 'backup', generation: 2 }));
    const coordinator = new ConnectedServiceQuotasCoordinator({
      api,
      credentials,
      quotaFetchers: [],
      now: () => now,
      randomBytes: (length: number) => randomBytes(length),
      authGroupSwitchCoordinator: { switchBeforeTurn },
      sameAccountFanoutMinIntervalMs: 60_000,
      sameAccountFanoutStrategyResolver: () => 'provider_account_id',
    });
    const registerGroupSession = (sessionId: string, pid: number) => {
      coordinator.registerSpawnTarget({
        pid,
        sessionId,
        connectedServicesBindingsRaw: {
          v: 1,
          bindingsByServiceId: {
            'openai-codex': {
              source: 'connected',
              selection: 'group',
              groupId: 'team',
            },
          },
        },
        connectedServiceSelectionsEnv: {
          [HAPPIER_CONNECTED_SERVICE_SELECTIONS_ENV_KEY]: JSON.stringify([{
            kind: 'group',
            serviceId: 'openai-codex',
            groupId: 'team',
            activeProfileId: 'primary',
            fallbackProfileId: 'backup',
            generation: 4,
          }]),
        },
      });
    };
    registerGroupSession('source', 301);
    await expect(coordinator.recordAccountExhaustionAndFanout({
      sourceSessionId: 'source',
      serviceId: 'openai-codex',
      groupId: 'team',
      exhaustedProfileId: 'primary',
      providerAccountId: 'acct-a',
      resetAtMs: 1_200_000,
      reason: 'usage_limit',
    })).resolves.toEqual({
      status: 'recorded',
      fanoutCandidates: 0,
      fanoutRequests: 0,
    });

    now += 10_000;
    registerGroupSession('same-account', 302);
    coordinator.recordRuntimeAccountIdentityFromSnapshot({
      sessionId: 'same-account',
      serviceId: 'openai-codex',
      groupId: 'team',
      profileId: 'primary',
      providerAccountId: 'acct-a',
      accountLabel: null,
      observedAtMs: now,
      source: 'active_account_verification',
      proofStrength: 'exact',
      groupGeneration: 4,
    });
    await coordinator.recordAccountExhaustionAndFanout({
      sourceSessionId: 'source',
      serviceId: 'openai-codex',
      groupId: 'team',
      exhaustedProfileId: 'primary',
      providerAccountId: 'acct-a',
      resetAtMs: 1_200_001,
      reason: 'usage_limit',
    });

    expect(switchBeforeTurn).toHaveBeenCalledTimes(1);
  });

  it('does not coalesce same-account exhaustion fanout across independent groups', async () => {
    let now = 1_000_000;
    const credentials: Credentials = {
      token: 'happy-token',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(9) },
    };
    const api = {
      getAccountEncryptionMode: vi.fn(async () => 'plain' as const),
      getConnectedServiceQuotaSnapshotPlain: vi.fn(async () => null),
      getConnectedServiceCredentialPlain: vi.fn(async () => null),
      registerConnectedServiceQuotaSnapshotPlain: vi.fn(async () => {}),
      getConnectedServiceQuotaSnapshotSealed: vi.fn(async () => null),
      getConnectedServiceCredentialSealed: vi.fn(async () => null),
      registerConnectedServiceQuotaSnapshotSealed: vi.fn(async () => {}),
    } as unknown as QuotaApi;
    const switchBeforeTurn = vi.fn(async () => ({ status: 'switched' as const, activeProfileId: 'backup', generation: 2 }));
    const coordinator = new ConnectedServiceQuotasCoordinator({
      api,
      credentials,
      quotaFetchers: [],
      now: () => now,
      randomBytes: (length: number) => randomBytes(length),
      authGroupSwitchCoordinator: { switchBeforeTurn },
      sameAccountFanoutMinIntervalMs: 60_000,
      sameAccountFanoutStrategyResolver: () => 'provider_account_id',
    });
    const registerGroupSession = (sessionId: string, pid: number, groupId: string) => {
      coordinator.registerSpawnTarget({
        pid,
        sessionId,
        connectedServicesBindingsRaw: {
          v: 1,
          bindingsByServiceId: {
            'openai-codex': {
              source: 'connected',
              selection: 'group',
              groupId,
            },
          },
        },
        connectedServiceSelectionsEnv: {
          [HAPPIER_CONNECTED_SERVICE_SELECTIONS_ENV_KEY]: JSON.stringify([{
            kind: 'group',
            serviceId: 'openai-codex',
            groupId,
            activeProfileId: 'primary',
            fallbackProfileId: 'backup',
            generation: 4,
          }]),
        },
      });
    };
    registerGroupSession('source-a', 401, 'team-a');
    registerGroupSession('same-account-a', 402, 'team-a');
    registerGroupSession('source-b', 403, 'team-b');
    registerGroupSession('same-account-b', 404, 'team-b');
    for (const [sessionId, groupId] of [
      ['same-account-a', 'team-a'],
      ['same-account-b', 'team-b'],
    ] as const) {
      coordinator.recordRuntimeAccountIdentityFromSnapshot({
        sessionId,
        serviceId: 'openai-codex',
        groupId,
        profileId: 'primary',
        providerAccountId: 'acct-a',
        accountLabel: null,
        observedAtMs: now,
        source: 'active_account_verification',
        proofStrength: 'exact',
        groupGeneration: 4,
      });
    }

    await coordinator.recordAccountExhaustionAndFanout({
      sourceSessionId: 'source-a',
      serviceId: 'openai-codex',
      groupId: 'team-a',
      exhaustedProfileId: 'primary',
      providerAccountId: 'acct-a',
      resetAtMs: 1_200_000,
      reason: 'usage_limit',
    });
    now += 10_000;
    await coordinator.recordAccountExhaustionAndFanout({
      sourceSessionId: 'source-b',
      serviceId: 'openai-codex',
      groupId: 'team-b',
      exhaustedProfileId: 'primary',
      providerAccountId: 'acct-a',
      resetAtMs: 1_200_001,
      reason: 'usage_limit',
    });

    expect(switchBeforeTurn).toHaveBeenCalledTimes(2);
    expect(switchBeforeTurn).toHaveBeenNthCalledWith(1, {
      sessionId: 'same-account-a',
      serviceId: 'openai-codex',
      groupId: 'team-a',
      reason: 'same_provider_account_exhausted',
      observedProfileId: 'primary',
    });
    expect(switchBeforeTurn).toHaveBeenNthCalledWith(2, {
      sessionId: 'same-account-b',
      serviceId: 'openai-codex',
      groupId: 'team-b',
      reason: 'same_provider_account_exhausted',
      observedProfileId: 'primary',
    });
  });

  it('exposes fresh quota snapshots as central quota_probe_fresh proof without account-adoption proof', () => {
    const now = 1_000_000;
    const credentials: Credentials = {
      token: 'happy-token',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(9) },
    };
    const api = {
      getAccountEncryptionMode: vi.fn(async () => 'plain' as const),
      getConnectedServiceQuotaSnapshotPlain: vi.fn(async () => null),
      getConnectedServiceCredentialPlain: vi.fn(async () => null),
      registerConnectedServiceQuotaSnapshotPlain: vi.fn(async () => {}),
      getConnectedServiceQuotaSnapshotSealed: vi.fn(async () => null),
      getConnectedServiceCredentialSealed: vi.fn(async () => null),
      registerConnectedServiceQuotaSnapshotSealed: vi.fn(async () => {}),
    } as unknown as QuotaApi;
    const coordinator = new ConnectedServiceQuotasCoordinator({
      api,
      credentials,
      quotaFetchers: [],
      now: () => now,
      randomBytes: (length: number) => randomBytes(length),
      quotaLifecycleFreshnessMs: 60_000,
    });

    expect(coordinator.resolveQuotaProbeFreshProof({
      serviceId: 'openai-codex',
      profileId: 'backup',
      groupId: 'team',
      expectedGroupGeneration: 8,
      currentGroupGeneration: 8,
      expectedMaterialFingerprint: 'credential-fingerprint',
      snapshotMaterialFingerprint: 'credential-fingerprint',
      snapshot: {
        v: 1,
        serviceId: 'openai-codex',
        profileId: 'backup',
        fetchedAt: now - 10_000,
        staleAfterMs: 300_000,
        planLabel: null,
        accountLabel: null,
        meters: [{
          meterId: 'weekly',
          label: 'Weekly',
          used: 10,
          limit: 100,
          unit: 'requests',
          utilizationPct: 10,
          remainingPct: 90,
          resetsAt: now + 300_000,
          status: 'ok',
          details: {},
        }],
      },
    })).toEqual({
      status: 'proof',
      proofKind: 'quota_probe_fresh',
    });
  });

  it('probes requested group member quota snapshots for pre-turn selection', async () => {
    const now = 1_000_000;
    const runtimeQuotaSnapshots = new ConnectedServiceAuthGroupRuntimeQuotaSnapshotStore();

    const credentials: Credentials = {
      token: 'happy-token',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(9) },
    };

    const primaryRecord = buildConnectedServiceCredentialRecord({
      now,
      serviceId: 'openai-codex',
      profileId: 'primary',
      kind: 'oauth',
      expiresAt: now + 60_000,
      oauth: {
        accessToken: 'primary-access',
        refreshToken: 'primary-refresh',
        idToken: null,
        scope: null,
        tokenType: null,
        providerAccountId: 'primary-acct',
        providerEmail: 'primary@example.com',
      },
    });
    const backupRecord = buildConnectedServiceCredentialRecord({
      now,
      serviceId: 'openai-codex',
      profileId: 'backup',
      kind: 'oauth',
      expiresAt: now + 60_000,
      oauth: {
        accessToken: 'backup-access',
        refreshToken: 'backup-refresh',
        idToken: null,
        scope: null,
        tokenType: null,
        providerAccountId: 'backup-acct',
        providerEmail: 'backup@example.com',
      },
    });
    const records = new Map([
      ['primary', primaryRecord],
      ['backup', backupRecord],
    ]);

    const api = {
      getAccountEncryptionMode: vi.fn(async () => 'plain' as const),
      getConnectedServiceQuotaSnapshotPlain: vi.fn(async () => null),
      getConnectedServiceCredentialPlain: vi.fn(async ({ profileId }: { profileId: string }) => ({
        content: { t: 'plain' as const, v: records.get(profileId) ?? null },
      })),
      registerConnectedServiceQuotaSnapshotPlain: vi.fn(async () => {}),
      getConnectedServiceQuotaSnapshotSealed: vi.fn(async () => null),
      getConnectedServiceCredentialSealed: vi.fn(async () => null),
      registerConnectedServiceQuotaSnapshotSealed: vi.fn(async () => {}),
    } as unknown as QuotaApi;

    const fetcher: ConnectedServiceQuotaFetcher = {
      serviceId: 'openai-codex',
      fetch: vi.fn(async ({ record }): Promise<ConnectedServiceQuotaSnapshotV1 | null> => {
        const profileId = record.profileId;
        return {
          v: 1,
          serviceId: 'openai-codex',
          profileId,
          fetchedAt: now,
          staleAfterMs: 300_000,
          planLabel: 'Pro',
          accountLabel: null,
          meters: [
            {
              meterId: 'weekly',
              label: 'Weekly',
              used: null,
              limit: null,
              unit: 'unknown',
              utilizationPct: profileId === 'primary' ? 95 : 20,
              remainingPct: profileId === 'primary' ? 5 : 80,
              resetsAt: now + 60_000,
              status: 'ok',
              details: {},
            },
          ],
        };
      }),
    };

    const coordinator = new ConnectedServiceQuotasCoordinator({
      api,
      credentials,
      quotaFetchers: [fetcher],
      now: () => now,
      randomBytes: (length: number) => randomBytes(length),
      discoveryEnabled: false,
      runtimeQuotaSnapshots,
    });
    const probeGroupQuotaSnapshots = (coordinator as unknown as {
      probeGroupQuotaSnapshots?: (input: Readonly<{
        serviceId: 'openai-codex';
        groupId: string;
        profileIds: ReadonlyArray<string>;
      }>) => Promise<void>;
    }).probeGroupQuotaSnapshots;

    expect(typeof probeGroupQuotaSnapshots).toBe('function');
    if (typeof probeGroupQuotaSnapshots !== 'function') return;

    await probeGroupQuotaSnapshots.call(coordinator, {
      serviceId: 'openai-codex',
      groupId: 'team',
      profileIds: ['primary', 'backup'],
    });

    expect(fetcher.fetch).toHaveBeenCalledTimes(2);
    expect(runtimeQuotaSnapshots.buildMemberStates({
      serviceId: 'openai-codex',
      groupId: 'team',
      capturedAtMs: now,
    }).get('backup')?.quotaSnapshot?.effectiveRemainingPercent).toBe(80);
    await coordinator.flushInBandQuotaPersistence(2_000);
    expect(api.registerConnectedServiceQuotaSnapshotPlain).toHaveBeenCalledTimes(2);
    // RD-QUO-3: probe-driven persistence goes through the same HMAC-fingerprinted
    // idempotency path as event-driven snapshots — never the legacy unconditional upsert.
    const registerCalls = (api.registerConnectedServiceQuotaSnapshotPlain as ReturnType<typeof vi.fn>).mock.calls;
    for (const call of registerCalls) {
      expect((call[0] as { metadata?: { materialFingerprint?: string } }).metadata?.materialFingerprint).toEqual(expect.any(String));
    }
  });

  it('clears stale persisted member quota blockers after a fresh usable group quota probe', async () => {
    const now = 1_000_000;
    const runtimeQuotaSnapshots = new ConnectedServiceAuthGroupRuntimeQuotaSnapshotStore();

    const credentials: Credentials = {
      token: 'happy-token',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(9) },
    };
    const record = buildConnectedServiceCredentialRecord({
      now,
      serviceId: 'openai-codex',
      profileId: 'backup',
      kind: 'oauth',
      expiresAt: now + 60_000,
      oauth: {
        accessToken: 'backup-access',
        refreshToken: 'backup-refresh',
        idToken: null,
        scope: null,
        tokenType: null,
        providerAccountId: 'backup-acct',
        providerEmail: 'backup@example.com',
      },
    });
    const group = {
      v: 1,
      serviceId: 'openai-codex',
      groupId: 'team',
      displayName: 'Team',
      activeProfileId: 'primary',
      generation: 4,
      policy: {
        v: 1,
        autoSwitch: true,
        cooldownMs: 500,
      },
      state: { v: 1 },
      members: [
        {
          v: 1,
          serviceId: 'openai-codex',
          groupId: 'team',
          profileId: 'backup',
          priority: 1,
          enabled: true,
          state: {
            quotaExhaustedUntilMs: now + 500_000,
            lastFailureKind: 'usage_limit',
            lastObservedAtMs: now - 10_000,
            providerResetsAtMs: now + 500_000,
          },
          createdAt: 1,
          updatedAt: 2,
        },
      ],
      createdAt: 1,
      updatedAt: 2,
    } as const;
    type RuntimeStatePatchCall = Readonly<{
      serviceId: 'openai-codex';
      groupId: string;
      expectedGeneration: number;
      memberStates: ReadonlyArray<Readonly<{
        profileId: string;
        state: Record<string, unknown>;
      }>>;
    }>;
    const updateConnectedServiceAuthGroupRuntimeState = vi.fn(async (_patch: RuntimeStatePatchCall) => group);
    const api = {
      getAccountEncryptionMode: vi.fn(async () => 'plain' as const),
      getConnectedServiceQuotaSnapshotPlain: vi.fn(async () => null),
      getConnectedServiceCredentialPlain: vi.fn(async () => ({ content: { t: 'plain' as const, v: record } })),
      registerConnectedServiceQuotaSnapshotPlain: vi.fn(async () => {}),
      getConnectedServiceQuotaSnapshotSealed: vi.fn(async () => null),
      getConnectedServiceCredentialSealed: vi.fn(async () => null),
      registerConnectedServiceQuotaSnapshotSealed: vi.fn(async () => {}),
      getConnectedServiceAuthGroup: vi.fn(async () => group),
      updateConnectedServiceAuthGroupRuntimeState,
    } as unknown as QuotaApi;
    const fetcher: ConnectedServiceQuotaFetcher = {
      serviceId: 'openai-codex',
      fetch: vi.fn(async ({ record: inputRecord }): Promise<ConnectedServiceQuotaSnapshotV1 | null> => ({
        v: 1,
        serviceId: inputRecord.serviceId,
        profileId: inputRecord.profileId,
        fetchedAt: now,
        staleAfterMs: 300_000,
        planLabel: 'Pro',
        accountLabel: null,
        meters: [
          {
            meterId: 'weekly',
            label: 'Weekly',
            used: null,
            limit: null,
            unit: 'unknown',
            utilizationPct: 20,
            remainingPct: 80,
            resetsAt: now + 60_000,
            status: 'ok',
            details: {},
          },
        ],
      })),
    };

    const coordinator = new ConnectedServiceQuotasCoordinator({
      api,
      credentials,
      quotaFetchers: [fetcher],
      now: () => now,
      randomBytes: (length: number) => randomBytes(length),
      discoveryEnabled: false,
      runtimeQuotaSnapshots,
    });
    const probeGroupQuotaSnapshots = (coordinator as unknown as {
      probeGroupQuotaSnapshots?: (input: Readonly<{
        serviceId: 'openai-codex';
        groupId: string;
        profileIds: ReadonlyArray<string>;
      }>) => Promise<void>;
    }).probeGroupQuotaSnapshots;

    expect(typeof probeGroupQuotaSnapshots).toBe('function');
    if (typeof probeGroupQuotaSnapshots !== 'function') return;

    await probeGroupQuotaSnapshots.call(coordinator, {
      serviceId: 'openai-codex',
      groupId: 'team',
      profileIds: ['backup'],
    });

    expect(updateConnectedServiceAuthGroupRuntimeState).toHaveBeenCalledTimes(1);
    const patch = updateConnectedServiceAuthGroupRuntimeState.mock.calls[0]?.[0];
    expect(patch).toEqual(expect.objectContaining({
      serviceId: 'openai-codex',
      groupId: 'team',
      expectedGeneration: 4,
    }));
    const memberState = patch?.memberStates?.[0]?.state as Record<string, unknown> | undefined;
    expect(memberState?.quotaExhaustedUntilMs).toBeUndefined();
    expect(memberState?.lastFailureKind).toBeUndefined();
    expect(memberState?.providerResetsAtMs).toBeUndefined();
    expect(memberState?.lastObservedAtMs).toBe(now - 10_000);
  });

  it('emits edge-triggered quota blocked/recovered lifecycle transitions for group-bound sessions (RD-QUO-13)', async () => {
    const now = Date.parse('2026-06-11T10:00:00.000Z');
    const resetAtMs = now + 500_000;
    const runtimeQuotaSnapshots = new ConnectedServiceAuthGroupRuntimeQuotaSnapshotStore();

    const credentials: Credentials = {
      token: 'happy-token',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(9) },
    };
    const buildRecord = (profileId: string) => buildConnectedServiceCredentialRecord({
      now,
      serviceId: 'openai-codex',
      profileId,
      kind: 'oauth',
      expiresAt: now + 60_000,
      oauth: {
        accessToken: `${profileId}-access`,
        refreshToken: `${profileId}-refresh`,
        idToken: null,
        scope: null,
        tokenType: null,
        providerAccountId: `${profileId}-acct`,
        providerEmail: `${profileId}@example.com`,
      },
    });
    const records = new Map([
      ['primary', buildRecord('primary')],
      ['backup', buildRecord('backup')],
    ]);

    type MutableMemberState = Record<string, unknown>;
    const memberStates = new Map<string, MutableMemberState>([
      ['primary', {
        quotaExhaustedUntilMs: resetAtMs,
        lastFailureKind: 'usage_limit',
        lastObservedAtMs: now - 10_000,
        providerResetsAtMs: resetAtMs,
      }],
      ['backup', {
        quotaExhaustedUntilMs: resetAtMs,
        lastFailureKind: 'usage_limit',
        lastObservedAtMs: now - 10_000,
        providerResetsAtMs: resetAtMs,
      }],
    ]);
    const buildGroup = () => ({
      v: 1,
      serviceId: 'openai-codex',
      groupId: 'team',
      displayName: 'Team',
      activeProfileId: 'primary',
      generation: 4,
      policy: {
        v: 1,
        autoSwitch: true,
        cooldownMs: 500,
      },
      state: { v: 1 },
      members: ['primary', 'backup'].map((profileId, index) => ({
        v: 1,
        serviceId: 'openai-codex',
        groupId: 'team',
        profileId,
        priority: index,
        enabled: true,
        state: memberStates.get(profileId) ?? {},
        createdAt: 1,
        updatedAt: 2,
      })),
      createdAt: 1,
      updatedAt: 2,
    });
    const updateConnectedServiceAuthGroupRuntimeState = vi.fn(async (patch: Readonly<{
      memberStates: ReadonlyArray<Readonly<{ profileId: string; state: Record<string, unknown> }>>;
    }>) => {
      for (const member of patch.memberStates) {
        memberStates.set(member.profileId, { ...member.state });
      }
      return buildGroup();
    });
    const api = {
      getAccountEncryptionMode: vi.fn(async () => 'plain' as const),
      getConnectedServiceQuotaSnapshotPlain: vi.fn(async () => null),
      getConnectedServiceCredentialPlain: vi.fn(async ({ profileId }: { profileId: string }) => ({
        content: { t: 'plain' as const, v: records.get(profileId) ?? null },
      })),
      registerConnectedServiceQuotaSnapshotPlain: vi.fn(async () => {}),
      getConnectedServiceQuotaSnapshotSealed: vi.fn(async () => null),
      getConnectedServiceCredentialSealed: vi.fn(async () => null),
      registerConnectedServiceQuotaSnapshotSealed: vi.fn(async () => {}),
      getConnectedServiceAuthGroup: vi.fn(async () => buildGroup()),
      updateConnectedServiceAuthGroupRuntimeState,
    } as unknown as QuotaApi;

    const remainingByProfileId = new Map<string, number>([['primary', 0], ['backup', 0]]);
    const fetcher: ConnectedServiceQuotaFetcher = {
      serviceId: 'openai-codex',
      fetch: vi.fn(async ({ record }): Promise<ConnectedServiceQuotaSnapshotV1 | null> => {
        const remainingPct = remainingByProfileId.get(record.profileId) ?? 0;
        return {
          v: 1,
          serviceId: 'openai-codex',
          profileId: record.profileId,
          fetchedAt: now,
          staleAfterMs: 300_000,
          planLabel: 'Pro',
          accountLabel: null,
          meters: [{
            meterId: 'weekly',
            label: 'Weekly',
            used: null,
            limit: null,
            unit: 'unknown',
            utilizationPct: 100 - remainingPct,
            remainingPct,
            resetsAt: resetAtMs,
            status: 'ok',
            details: {},
          }],
        };
      }),
    };

    const onQuotaLifecycleTransition = vi.fn(async () => {});
    const coordinator = new ConnectedServiceQuotasCoordinator({
      api,
      credentials,
      quotaFetchers: [fetcher],
      now: () => now,
      randomBytes: (length: number) => randomBytes(length),
      discoveryEnabled: false,
      runtimeQuotaSnapshots,
      onQuotaLifecycleTransition,
    });
    coordinator.registerSpawnTarget({
      pid: 321,
      sessionId: 'session-quota-blocked',
      connectedServicesBindingsRaw: {
        v: 1,
        bindingsByServiceId: {
          'openai-codex': { source: 'connected', selection: 'group', groupId: 'team' },
        },
      },
      connectedServiceSelectionsEnv: {
        [HAPPIER_CONNECTED_SERVICE_SELECTIONS_ENV_KEY]: JSON.stringify([{
          kind: 'group',
          serviceId: 'openai-codex',
          groupId: 'team',
          activeProfileId: 'primary',
          fallbackProfileId: 'primary',
          generation: 4,
        }]),
      },
    });
    const probeGroupQuotaSnapshots = (coordinator as unknown as {
      probeGroupQuotaSnapshots: (input: Readonly<{
        serviceId: 'openai-codex';
        groupId: string;
        profileIds: ReadonlyArray<string>;
      }>) => Promise<void>;
    }).probeGroupQuotaSnapshots;

    // Fresh exhausted evidence for the active member + every member limited => blocked (once).
    await probeGroupQuotaSnapshots.call(coordinator, {
      serviceId: 'openai-codex',
      groupId: 'team',
      profileIds: ['primary'],
    });
    expect(onQuotaLifecycleTransition).toHaveBeenCalledTimes(1);
    expect(onQuotaLifecycleTransition).toHaveBeenCalledWith(expect.objectContaining({
      phase: 'blocked',
      serviceId: 'openai-codex',
      groupId: 'team',
      sessionIds: ['session-quota-blocked'],
      issueFingerprint: 'quota-blocked:openai-codex:team',
      resetAtMs,
    }));
    const blockedTransitionCall =
      (onQuotaLifecycleTransition.mock.calls as unknown as ReadonlyArray<readonly [Readonly<{ cycleId?: unknown }>]>)[0];
    const blockedCycleId = blockedTransitionCall?.[0]?.cycleId;
    expect(typeof blockedCycleId).toBe('string');
    expect(String(blockedCycleId)).toContain('blocked_at_');

    // Still blocked on the next observation: edge-triggered, no duplicate emission.
    await probeGroupQuotaSnapshots.call(coordinator, {
      serviceId: 'openai-codex',
      groupId: 'team',
      profileIds: ['primary'],
    });
    expect(onQuotaLifecycleTransition).toHaveBeenCalledTimes(1);

    // A quota-blocked group that later becomes blocked only by auth-invalid members is no
    // longer in quota lifecycle; clear the stale quota-blocked edge silently instead of
    // rendering a misleading "provider quota recovered" row.
    memberStates.set('primary', {
      credentialHealthStatus: 'needs_reauth',
      lastFailureKind: 'provider_auth_invalid',
      lastObservedAtMs: now,
    });
    memberStates.set('backup', {
      credentialHealthStatus: 'needs_reauth',
      lastFailureKind: 'provider_auth_invalid',
      lastObservedAtMs: now,
    });
    await (coordinator as unknown as {
      evaluateGroupQuotaLifecycle: (input: Readonly<{ group: ReturnType<typeof buildGroup>; now: number }>) => Promise<void>;
    }).evaluateGroupQuotaLifecycle({ group: buildGroup(), now });
    expect(onQuotaLifecycleTransition).toHaveBeenCalledTimes(1);

    // Fresh usable evidence frees a member in the same eligibility pass => recovered (once).
    memberStates.set('primary', {
      quotaExhaustedUntilMs: resetAtMs,
      lastFailureKind: 'usage_limit',
      lastObservedAtMs: now - 10_000,
      providerResetsAtMs: resetAtMs,
    });
    memberStates.set('backup', {
      quotaExhaustedUntilMs: resetAtMs,
      lastFailureKind: 'usage_limit',
      lastObservedAtMs: now - 10_000,
      providerResetsAtMs: resetAtMs,
    });
    await (coordinator as unknown as {
      evaluateGroupQuotaLifecycle: (input: Readonly<{ group: ReturnType<typeof buildGroup>; now: number }>) => Promise<void>;
    }).evaluateGroupQuotaLifecycle({ group: buildGroup(), now });
    expect(onQuotaLifecycleTransition).toHaveBeenCalledTimes(2);
    expect(onQuotaLifecycleTransition).toHaveBeenLastCalledWith(expect.objectContaining({
      phase: 'blocked',
      serviceId: 'openai-codex',
      groupId: 'team',
      sessionIds: ['session-quota-blocked'],
      issueFingerprint: 'quota-blocked:openai-codex:team',
      resetAtMs,
    }));
    remainingByProfileId.set('backup', 80);
    await probeGroupQuotaSnapshots.call(coordinator, {
      serviceId: 'openai-codex',
      groupId: 'team',
      profileIds: ['backup'],
    });
    expect(onQuotaLifecycleTransition).toHaveBeenCalledTimes(3);
    expect(onQuotaLifecycleTransition).toHaveBeenLastCalledWith(expect.objectContaining({
      phase: 'recovered',
      serviceId: 'openai-codex',
      groupId: 'team',
      sessionIds: ['session-quota-blocked'],
      issueFingerprint: 'quota-blocked:openai-codex:team',
    }));
    const recoveredTransitionCall =
      (onQuotaLifecycleTransition.mock.calls as unknown as ReadonlyArray<readonly [Readonly<{ cycleId?: unknown }>]>)[2];
    const recoveredCycleId = recoveredTransitionCall?.[0]?.cycleId;
    expect(recoveredCycleId).toBe(blockedCycleId);

    // Recovered state is also edge-triggered.
    await probeGroupQuotaSnapshots.call(coordinator, {
      serviceId: 'openai-codex',
      groupId: 'team',
      profileIds: ['backup'],
    });
    expect(onQuotaLifecycleTransition).toHaveBeenCalledTimes(3);
  });

  it('does not emit quota lifecycle transitions when every group member is auth-invalid', async () => {
    const now = Date.parse('2026-06-11T10:00:00.000Z');
    const runtimeQuotaSnapshots = new ConnectedServiceAuthGroupRuntimeQuotaSnapshotStore();
    const credentials: Credentials = {
      token: 'happy-token',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(9) },
    };

    const group = {
      v: 1,
      serviceId: 'openai-codex',
      groupId: 'team',
      displayName: 'Team',
      activeProfileId: 'primary',
      generation: 4,
      policy: {
        v: 1,
        autoSwitch: true,
        cooldownMs: 500,
      },
      state: { v: 1 },
      members: ['primary', 'backup'].map((profileId, index) => ({
        v: 1,
        serviceId: 'openai-codex',
        groupId: 'team',
        profileId,
        priority: index,
        enabled: true,
        state: {
          credentialHealthStatus: 'needs_reauth',
          lastFailureKind: 'provider_auth_invalid',
          lastObservedAtMs: now,
        },
        createdAt: 1,
        updatedAt: 2,
      })),
      createdAt: 1,
      updatedAt: 2,
    };
    const onQuotaLifecycleTransition = vi.fn(async () => {});
    const coordinator = new ConnectedServiceQuotasCoordinator({
      api: {} as unknown as QuotaApi,
      credentials,
      quotaFetchers: [],
      now: () => now,
      randomBytes: (length: number) => randomBytes(length),
      discoveryEnabled: false,
      runtimeQuotaSnapshots,
      onQuotaLifecycleTransition,
    });
    coordinator.registerSpawnTarget({
      pid: 321,
      sessionId: 'session-auth-invalid',
      connectedServicesBindingsRaw: {
        v: 1,
        bindingsByServiceId: {
          'openai-codex': { source: 'connected', selection: 'group', groupId: 'team' },
        },
      },
      connectedServiceSelectionsEnv: {
        [HAPPIER_CONNECTED_SERVICE_SELECTIONS_ENV_KEY]: JSON.stringify([{
          kind: 'group',
          serviceId: 'openai-codex',
          groupId: 'team',
          activeProfileId: 'primary',
          fallbackProfileId: 'primary',
          generation: 4,
        }]),
      },
    });

    await (coordinator as unknown as {
      evaluateGroupQuotaLifecycle: (input: Readonly<{ group: typeof group; now: number }>) => Promise<void>;
    }).evaluateGroupQuotaLifecycle({ group, now });

    expect(onQuotaLifecycleTransition).not.toHaveBeenCalled();
  });

  it('hydrates auth-group quota selection state from fresh persisted quota snapshots', async () => {
    const now = 1_000_000;
    const runtimeQuotaSnapshots = new ConnectedServiceAuthGroupRuntimeQuotaSnapshotStore();

    const credentials: Credentials = {
      token: 'happy-token',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(9) },
    };

    const existingSnapshot: ConnectedServiceQuotaSnapshotV1 = {
      v: 1,
      serviceId: 'openai-codex',
      profileId: 'idle-backup',
      fetchedAt: now - 1_000,
      staleAfterMs: 300_000,
      planLabel: 'Pro',
      accountLabel: 'backup@example.com',
      meters: [
        {
          meterId: 'weekly',
          label: 'Weekly',
          used: null,
          limit: null,
          unit: 'unknown',
          utilizationPct: 20,
          resetsAt: null,
          status: 'ok',
          details: {},
        },
      ],
    };

    const api = {
      getAccountEncryptionMode: vi.fn(async () => 'plain' as const),
      listConnectedServiceProfiles: vi.fn(async () => ({
        serviceId: 'openai-codex' as const,
        profiles: [{ profileId: 'idle-backup', status: 'connected' as const }],
      })),
      getConnectedServiceQuotaSnapshotPlain: vi.fn(async () => ({
        content: { t: 'plain' as const, v: existingSnapshot },
        metadata: { fetchedAt: now - 1_000, staleAfterMs: 300_000, status: 'ok' as const },
      })),
      getConnectedServiceCredentialPlain: vi.fn(async () => null),
      registerConnectedServiceQuotaSnapshotPlain: vi.fn(async () => {}),
      getConnectedServiceQuotaSnapshotSealed: vi.fn(async () => null),
      getConnectedServiceCredentialSealed: vi.fn(async () => null),
      registerConnectedServiceQuotaSnapshotSealed: vi.fn(async () => {}),
    } as unknown as QuotaApi;

    const fetcher: ConnectedServiceQuotaFetcher = {
      serviceId: 'openai-codex',
      fetch: vi.fn(),
    };

    const coordinator = new ConnectedServiceQuotasCoordinator({
      api,
      credentials,
      quotaFetchers: [fetcher],
      runtimeQuotaSnapshots,
      now: () => now,
      randomBytes: (length: number) => randomBytes(length),
    });

    await coordinator.tickOnce();

    expect(fetcher.fetch).not.toHaveBeenCalled();
    expect(runtimeQuotaSnapshots.buildMemberStates({
      serviceId: 'openai-codex',
      groupId: 'main',
      capturedAtMs: now,
    }).get('idle-backup')?.quotaSnapshot?.effectiveRemainingPercent).toBe(80);
  });

  it('hydrates persisted quota snapshots for explicit auth-group members on demand', async () => {
    const now = 1_000_000;
    const runtimeQuotaSnapshots = new ConnectedServiceAuthGroupRuntimeQuotaSnapshotStore();
    const credentials: Credentials = {
      token: 'happy-token',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(9) },
    };
    const snapshot: ConnectedServiceQuotaSnapshotV1 = {
      v: 1,
      serviceId: 'openai-codex',
      profileId: 'backup',
      fetchedAt: now - 5_000,
      staleAfterMs: 300_000,
      planLabel: 'Pro',
      accountLabel: 'backup@example.com',
      meters: [
        {
          meterId: 'weekly',
          label: 'Weekly',
          used: null,
          limit: null,
          unit: 'unknown',
          utilizationPct: 10,
          resetsAt: null,
          status: 'ok',
          details: {},
        },
      ],
    };
    const api = {
      getAccountEncryptionMode: vi.fn(async () => 'plain' as const),
      getConnectedServiceQuotaSnapshotPlain: vi.fn(async ({ profileId }: { profileId: string }) => profileId === 'backup'
        ? {
            content: { t: 'plain' as const, v: snapshot },
            metadata: { fetchedAt: snapshot.fetchedAt, staleAfterMs: snapshot.staleAfterMs, status: 'ok' as const },
          }
        : null),
      getConnectedServiceCredentialPlain: vi.fn(async () => null),
      registerConnectedServiceQuotaSnapshotPlain: vi.fn(async () => {}),
      getConnectedServiceQuotaSnapshotSealed: vi.fn(async () => null),
      getConnectedServiceCredentialSealed: vi.fn(async () => null),
      registerConnectedServiceQuotaSnapshotSealed: vi.fn(async () => {}),
    } as unknown as QuotaApi;
    const coordinator = new ConnectedServiceQuotasCoordinator({
      api,
      credentials,
      quotaFetchers: [],
      runtimeQuotaSnapshots,
      now: () => now,
      randomBytes: (length: number) => randomBytes(length),
    });
    const quotaHydrator = coordinator as unknown as {
      hydratePersistedQuotaSnapshotsForGroup(input: Readonly<{
        serviceId: 'openai-codex';
        groupId: string;
        profileIds: ReadonlyArray<string>;
      }>): Promise<void>;
    };

    await quotaHydrator.hydratePersistedQuotaSnapshotsForGroup({
      serviceId: 'openai-codex',
      groupId: 'main',
      profileIds: ['primary', 'backup'],
    });

    expect(api.getConnectedServiceQuotaSnapshotPlain).toHaveBeenCalledWith({ serviceId: 'openai-codex', profileId: 'backup' });
    expect(runtimeQuotaSnapshots.getSnapshot({
      serviceId: 'openai-codex',
      groupId: 'main',
      profileId: 'backup',
    })?.fetchedAt).toBe(snapshot.fetchedAt);
  });

  it('derives a non-ok metadata status when all meters are unavailable', async () => {
    const now = 1_000_000;

    const credentials: Credentials = {
      token: 'happy-token',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(9) },
    };
    if (credentials.encryption.type !== 'legacy') throw new Error('fixture');

    const record = buildConnectedServiceCredentialRecord({
      now,
      serviceId: 'openai-codex',
      profileId: 'work',
      kind: 'oauth',
      expiresAt: now + 60_000,
      oauth: {
        accessToken: 'access',
        refreshToken: 'refresh',
        idToken: null,
        scope: null,
        tokenType: null,
        providerAccountId: 'acct',
        providerEmail: 'user@example.com',
      },
    });

    const sealedCredentialCiphertext = sealAccountScopedBlobCiphertext({
      kind: 'connected_service_credential',
      material: { type: 'legacy', secret: credentials.encryption.secret },
      payload: record,
      randomBytes: (length) => randomBytes(length),
    });
    const sealedCredential: SealedCredentialResponse = {
      sealed: { format: 'account_scoped_v1', ciphertext: sealedCredentialCiphertext },
      metadata: { kind: 'oauth' },
    };

    let uploadedStatus: string | null = null;
    const api = {
      getConnectedServiceQuotaSnapshotSealed: vi.fn(async () => null),
      getConnectedServiceCredentialSealed: vi.fn(async (): Promise<SealedCredentialResponse | null> => sealedCredential),
      registerConnectedServiceQuotaSnapshotSealed: vi.fn(async (params: RegisterArgs) => {
        uploadedStatus = params.metadata?.status ?? null;
      }),
    } satisfies QuotaApi;

    const fetcher: ConnectedServiceQuotaFetcher = {
      serviceId: 'openai-codex',
      fetch: vi.fn(async ({ record: inputRecord }: FetchArgs): Promise<ConnectedServiceQuotaSnapshotV1 | null> => ({
        v: 1,
        serviceId: inputRecord.serviceId,
        profileId: inputRecord.profileId,
        fetchedAt: now,
        staleAfterMs: 300_000,
        planLabel: 'Pro',
        accountLabel: 'user@example.com',
        meters: [
          {
            meterId: 'weekly',
            label: 'Weekly',
            used: null,
            limit: null,
            unit: 'unknown',
            utilizationPct: null,
            resetsAt: null,
            status: 'unavailable',
            details: {},
          },
        ],
      })),
    };

    const coordinator = new ConnectedServiceQuotasCoordinator({
      api,
      credentials,
      quotaFetchers: [fetcher],
      now: () => now,
      randomBytes: (length: number) => randomBytes(length),
    });

    coordinator.registerSpawnTarget({
      pid: 123,
      connectedServicesBindingsRaw: {
        v: 1,
        bindingsByServiceId: { 'openai-codex': { source: 'connected', profileId: 'work' } },
      },
    });

    await coordinator.tickOnce();
    expect(uploadedStatus).toBe('unavailable');
  });

  it('supports profile ids that contain ":"', async () => {
    const now = 1_000_000;

    const credentials: Credentials = {
      token: 'happy-token',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(9) },
    };
    if (credentials.encryption.type !== 'legacy') throw new Error('fixture');

    const record = buildConnectedServiceCredentialRecord({
      now,
      serviceId: 'openai-codex',
      profileId: 'work:us',
      kind: 'oauth',
      expiresAt: now + 60_000,
      oauth: {
        accessToken: 'access',
        refreshToken: 'refresh',
        idToken: null,
        scope: null,
        tokenType: null,
        providerAccountId: 'acct',
        providerEmail: 'user@example.com',
      },
    });

    const sealedCredentialCiphertext = sealAccountScopedBlobCiphertext({
      kind: 'connected_service_credential',
      material: { type: 'legacy', secret: credentials.encryption.secret },
      payload: record,
      randomBytes: (length) => randomBytes(length),
    });
    const sealedCredential: SealedCredentialResponse = {
      sealed: { format: 'account_scoped_v1', ciphertext: sealedCredentialCiphertext },
      metadata: { kind: 'oauth' },
    };

    const api = {
      getConnectedServiceQuotaSnapshotSealed: vi.fn(async () => null),
      getConnectedServiceCredentialSealed: vi.fn(async (
        args: Parameters<QuotaApi['getConnectedServiceCredentialSealed']>[0],
      ): Promise<SealedCredentialResponse | null> => {
        if (args.profileId !== 'work:us') return null;
        return sealedCredential;
      }),
      registerConnectedServiceQuotaSnapshotSealed: vi.fn(async () => {}),
    } satisfies QuotaApi;

    const fetcher: ConnectedServiceQuotaFetcher = {
      serviceId: 'openai-codex',
      fetch: vi.fn(async (_args: FetchArgs): Promise<ConnectedServiceQuotaSnapshotV1 | null> => ({
        v: 1,
        serviceId: record.serviceId,
        profileId: record.profileId,
        fetchedAt: now,
        staleAfterMs: 300_000,
        planLabel: 'Pro',
        accountLabel: 'user@example.com',
        meters: [],
      })),
    };

    const coordinator = new ConnectedServiceQuotasCoordinator({
      api,
      credentials,
      quotaFetchers: [fetcher],
      now: () => now,
      randomBytes: (length: number) => randomBytes(length),
    });

    coordinator.registerSpawnTarget({
      pid: 123,
      connectedServicesBindingsRaw: {
        v: 1,
        bindingsByServiceId: { 'openai-codex': { source: 'connected', profileId: 'work:us' } },
      },
    });

    await coordinator.tickOnce();
    expect(api.getConnectedServiceCredentialSealed).toHaveBeenCalledWith({ serviceId: 'openai-codex', profileId: 'work:us' });
    expect(fetcher.fetch).toHaveBeenCalledTimes(1);
  });

  it('refreshes near-expiry credentials through the central lifecycle before fetching quotas', async () => {
    const now = 1_000_000;
    const credentials: Credentials = {
      token: 'happy-token',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(9) },
    };
    const staleRecord = buildConnectedServiceCredentialRecord({
      now,
      serviceId: 'openai-codex',
      profileId: 'work',
      kind: 'oauth',
      expiresAt: now + 30_000,
      oauth: {
        accessToken: 'stale-access',
        refreshToken: 'refresh',
        idToken: null,
        scope: null,
        tokenType: null,
        providerAccountId: 'acct',
        providerEmail: 'user@example.com',
      },
    });
    const freshRecord = buildConnectedServiceCredentialRecord({
      now,
      serviceId: 'openai-codex',
      profileId: 'work',
      kind: 'oauth',
      expiresAt: now + 3_600_000,
      oauth: {
        accessToken: 'fresh-access',
        refreshToken: 'refresh',
        idToken: null,
        scope: null,
        tokenType: null,
        providerAccountId: 'acct',
        providerEmail: 'user@example.com',
      },
    });
    const api = {
      getAccountEncryptionMode: vi.fn(async () => 'plain' as const),
      getConnectedServiceQuotaSnapshotPlain: vi.fn(async () => null),
      getConnectedServiceCredentialPlain: vi.fn(async () => ({ content: { t: 'plain' as const, v: staleRecord } })),
      registerConnectedServiceQuotaSnapshotPlain: vi.fn(async () => {}),
      getConnectedServiceQuotaSnapshotSealed: vi.fn(async () => null),
      getConnectedServiceCredentialSealed: vi.fn(async () => null),
      registerConnectedServiceQuotaSnapshotSealed: vi.fn(async () => {}),
    } as unknown as QuotaApi;
    const refreshConnectedServiceCredentialForQuota = vi.fn(async () => freshRecord);
    let observedAccessToken: string | null = null;
    const fetcher: ConnectedServiceQuotaFetcher = {
      serviceId: 'openai-codex',
      fetch: vi.fn(async ({ record: inputRecord }: FetchArgs): Promise<ConnectedServiceQuotaSnapshotV1 | null> => {
        observedAccessToken = inputRecord.kind === 'oauth' ? inputRecord.oauth.accessToken : null;
        return {
          v: 1,
          serviceId: inputRecord.serviceId,
          profileId: inputRecord.profileId,
          fetchedAt: now,
          staleAfterMs: 300_000,
          planLabel: 'Pro',
          accountLabel: 'user@example.com',
          meters: [],
        };
      }),
    };

    const params = {
      api,
      credentials,
      quotaFetchers: [fetcher],
      now: () => now,
      randomBytes: (length: number) => randomBytes(length),
      refreshConnectedServiceCredentialForQuota,
    } satisfies ConstructorParameters<typeof ConnectedServiceQuotasCoordinator>[0] & Readonly<{
      refreshConnectedServiceCredentialForQuota: typeof refreshConnectedServiceCredentialForQuota;
    }>;
    const coordinator = new ConnectedServiceQuotasCoordinator(params);
    coordinator.registerSpawnTarget({
      pid: 123,
      connectedServicesBindingsRaw: {
        v: 1,
        bindingsByServiceId: { 'openai-codex': { source: 'connected', profileId: 'work' } },
      },
    });

    await coordinator.tickOnce();

    expect(refreshConnectedServiceCredentialForQuota).toHaveBeenCalledWith({
      serviceId: 'openai-codex',
      profileId: 'work',
      force: false,
      reason: 'near_expiry',
    });
    expect(observedAccessToken).toBe('fresh-access');
  });

  it('delegates provider auth failures to the central refresh lifecycle once before reconnect backoff', async () => {
    const now = 1_000_000;
    const credentials: Credentials = {
      token: 'happy-token',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(9) },
    };
    const staleRecord = buildConnectedServiceCredentialRecord({
      now,
      serviceId: 'openai-codex',
      profileId: 'work',
      kind: 'oauth',
      expiresAt: now + 3_600_000,
      oauth: {
        accessToken: 'stale-access',
        refreshToken: 'refresh',
        idToken: null,
        scope: null,
        tokenType: null,
        providerAccountId: 'acct',
        providerEmail: 'user@example.com',
      },
    });
    const freshRecord = buildConnectedServiceCredentialRecord({
      now,
      serviceId: 'openai-codex',
      profileId: 'work',
      kind: 'oauth',
      expiresAt: now + 3_600_000,
      oauth: {
        accessToken: 'fresh-access',
        refreshToken: 'refresh',
        idToken: null,
        scope: null,
        tokenType: null,
        providerAccountId: 'acct',
        providerEmail: 'user@example.com',
      },
    });
    const api = {
      getAccountEncryptionMode: vi.fn(async () => 'plain' as const),
      getConnectedServiceQuotaSnapshotPlain: vi.fn(async () => null),
      getConnectedServiceCredentialPlain: vi.fn(async () => ({ content: { t: 'plain' as const, v: staleRecord } })),
      registerConnectedServiceQuotaSnapshotPlain: vi.fn(async () => {}),
      getConnectedServiceQuotaSnapshotSealed: vi.fn(async () => null),
      getConnectedServiceCredentialSealed: vi.fn(async () => null),
      registerConnectedServiceQuotaSnapshotSealed: vi.fn(async () => {}),
    } as unknown as QuotaApi;
    const refreshConnectedServiceCredentialForQuota = vi.fn(async () => freshRecord);
    let attempts = 0;
    const fetcher: ConnectedServiceQuotaFetcher = {
      serviceId: 'openai-codex',
      fetch: vi.fn(async ({ record: inputRecord }: FetchArgs): Promise<ConnectedServiceQuotaSnapshotV1 | null> => {
        attempts += 1;
        if (attempts === 1) {
          throw Object.assign(new Error('provider auth failed'), {
            quotaFetchErrorCode: 'auth_failure',
            status: 401,
          });
        }
        return {
          v: 1,
          serviceId: inputRecord.serviceId,
          profileId: inputRecord.profileId,
          fetchedAt: now,
          staleAfterMs: 300_000,
          planLabel: 'Pro',
          accountLabel: 'user@example.com',
          meters: [],
        };
      }),
    };
    const params = {
      api,
      credentials,
      quotaFetchers: [fetcher],
      now: () => now,
      randomBytes: (length: number) => randomBytes(length),
      refreshConnectedServiceCredentialForQuota,
    } satisfies ConstructorParameters<typeof ConnectedServiceQuotasCoordinator>[0] & Readonly<{
      refreshConnectedServiceCredentialForQuota: typeof refreshConnectedServiceCredentialForQuota;
    }>;
    const coordinator = new ConnectedServiceQuotasCoordinator(params);
    coordinator.registerSpawnTarget({
      pid: 123,
      connectedServicesBindingsRaw: {
        v: 1,
        bindingsByServiceId: { 'openai-codex': { source: 'connected', profileId: 'work' } },
      },
    });

    await coordinator.tickOnce();

    expect(fetcher.fetch).toHaveBeenCalledTimes(2);
    expect(refreshConnectedServiceCredentialForQuota).toHaveBeenCalledWith({
      serviceId: 'openai-codex',
      profileId: 'work',
      force: true,
      reason: 'auth_failure',
    });
    expect(api.registerConnectedServiceQuotaSnapshotPlain).toHaveBeenCalledTimes(1);
  });

  it('marks unrecovered quota auth failures as reconnect-required credential health', async () => {
    const now = 1_000_000;
    const credentials: Credentials = {
      token: 'happy-token',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(9) },
    };
    const record = buildConnectedServiceCredentialRecord({
      now,
      serviceId: 'claude-subscription',
      profileId: 'legacy',
      kind: 'oauth',
      expiresAt: now + 3_600_000,
      oauth: {
        accessToken: 'legacy-access',
        refreshToken: 'refresh',
        idToken: null,
        scope: 'user:inference user:profile',
        tokenType: null,
        providerAccountId: 'acct',
        providerEmail: 'user@example.com',
      },
    });
    const api = {
      getAccountEncryptionMode: vi.fn(async () => 'plain' as const),
      getConnectedServiceQuotaSnapshotPlain: vi.fn(async () => null),
      getConnectedServiceCredentialPlain: vi.fn(async () => ({ content: { t: 'plain' as const, v: record } })),
      registerConnectedServiceQuotaSnapshotPlain: vi.fn(async () => {}),
      getConnectedServiceQuotaSnapshotSealed: vi.fn(async () => null),
      getConnectedServiceCredentialSealed: vi.fn(async () => null),
      registerConnectedServiceQuotaSnapshotSealed: vi.fn(async () => {}),
      updateConnectedServiceCredentialHealth: vi.fn(async () => {}),
    } as unknown as QuotaApi;
    const refreshConnectedServiceCredentialForQuota = vi.fn(async () => null);
    const fetcher: ConnectedServiceQuotaFetcher = {
      serviceId: 'claude-subscription',
      fetch: vi.fn(async () => {
        throw new ConnectedServiceQuotaFetchError(
          'Claude subscription is missing Claude Code OAuth scope; reconnect Claude in Happier and retry.',
          {
            status: 403,
            quotaFetchErrorCode: 'auth_failure',
            providerCode: 'missing_claude_code_scope',
          },
        );
      }),
    };

    const coordinator = new ConnectedServiceQuotasCoordinator({
      api,
      credentials,
      quotaFetchers: [fetcher],
      now: () => now,
      randomBytes: (length: number) => randomBytes(length),
      refreshConnectedServiceCredentialForQuota,
    });
    coordinator.registerSpawnTarget({
      pid: 123,
      connectedServicesBindingsRaw: {
        v: 1,
        bindingsByServiceId: { 'claude-subscription': { source: 'connected', profileId: 'legacy' } },
      },
    });

    await coordinator.tickOnce();

    expect(refreshConnectedServiceCredentialForQuota).toHaveBeenCalledWith({
      serviceId: 'claude-subscription',
      profileId: 'legacy',
      force: true,
      reason: 'auth_failure',
    });
    expect(api.updateConnectedServiceCredentialHealth).toHaveBeenCalledWith({
      serviceId: 'claude-subscription',
      profileId: 'legacy',
      health: {
        v: 1,
        status: 'needs_reauth',
        reconnectRequired: true,
        lastRefreshAttemptAt: now,
        lastRefreshFailureAt: now,
        lastRefreshFailureKind: 'provider_403',
        providerHttpStatus: 403,
        providerErrorCode: 'missing_claude_code_scope',
      },
    });
    expect(api.registerConnectedServiceQuotaSnapshotPlain).not.toHaveBeenCalled();
  });

  it('keeps transient unrecovered quota 401 failures retryable before reconnect escalation', async () => {
    let now = 1_000_000;
    const credentials: Credentials = {
      token: 'happy-token',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(9) },
    };
    const record = buildConnectedServiceCredentialRecord({
      now,
      serviceId: 'claude-subscription',
      profileId: 'work',
      kind: 'oauth',
      expiresAt: now + 3_600_000,
      oauth: {
        accessToken: 'access',
        refreshToken: 'refresh',
        idToken: null,
        scope: 'user:inference user:profile',
        tokenType: null,
        providerAccountId: 'acct',
        providerEmail: 'user@example.com',
      },
    });
    const api = {
      getAccountEncryptionMode: vi.fn(async () => 'plain' as const),
      getConnectedServiceQuotaSnapshotPlain: vi.fn(async () => null),
      getConnectedServiceCredentialPlain: vi.fn(async () => ({ content: { t: 'plain' as const, v: record } })),
      registerConnectedServiceQuotaSnapshotPlain: vi.fn(async () => {}),
      getConnectedServiceQuotaSnapshotSealed: vi.fn(async () => null),
      getConnectedServiceCredentialSealed: vi.fn(async () => null),
      registerConnectedServiceQuotaSnapshotSealed: vi.fn(async () => {}),
      updateConnectedServiceCredentialHealth: vi.fn(async () => {}),
    } as unknown as QuotaApi;
    const refreshConnectedServiceCredentialForQuota = vi.fn(async () => null);
    const fetcher: ConnectedServiceQuotaFetcher = {
      serviceId: 'claude-subscription',
      fetch: vi.fn(async () => {
        throw Object.assign(new Error('provider auth failed'), {
          quotaFetchErrorCode: 'auth_failure',
          status: 401,
        });
      }),
    };

    const coordinator = new ConnectedServiceQuotasCoordinator({
      api,
      credentials,
      quotaFetchers: [fetcher],
      now: () => now,
      randomBytes: (length: number) => new Uint8Array(length).fill(1),
      failureBackoffMinMs: 10_000,
      failureBackoffMaxMs: 60_000,
      failureBackoffJitterPct: 0,
      refreshConnectedServiceCredentialForQuota,
    });
    coordinator.registerSpawnTarget({
      pid: 123,
      connectedServicesBindingsRaw: {
        v: 1,
        bindingsByServiceId: { 'claude-subscription': { source: 'connected', profileId: 'work' } },
      },
    });

    await coordinator.tickOnce();
    now += 10_000;
    await coordinator.tickOnce();

    expect(refreshConnectedServiceCredentialForQuota).toHaveBeenCalledTimes(2);
    expect(api.updateConnectedServiceCredentialHealth).toHaveBeenNthCalledWith(1, {
      serviceId: 'claude-subscription',
      profileId: 'work',
      health: {
        v: 1,
        status: 'refresh_failed_retryable',
        reconnectRequired: false,
        lastRefreshAttemptAt: 1_000_000,
        lastRefreshFailureAt: 1_000_000,
        lastRefreshFailureKind: 'provider_401',
        providerHttpStatus: 401,
      },
    });
    expect(api.updateConnectedServiceCredentialHealth).toHaveBeenNthCalledWith(2, {
      serviceId: 'claude-subscription',
      profileId: 'work',
      health: {
        v: 1,
        status: 'refresh_failed_retryable',
        reconnectRequired: false,
        lastRefreshAttemptAt: 1_010_000,
        lastRefreshFailureAt: 1_010_000,
        lastRefreshFailureKind: 'provider_401',
        providerHttpStatus: 401,
      },
    });
    expect(api.registerConnectedServiceQuotaSnapshotPlain).not.toHaveBeenCalled();
  });

  it('escalates repeated unrecovered quota 401 failures after the quota backoff retry window', async () => {
    let now = 1_000_000;
    const credentials: Credentials = {
      token: 'happy-token',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(9) },
    };
    const record = buildConnectedServiceCredentialRecord({
      now,
      serviceId: 'claude-subscription',
      profileId: 'work',
      kind: 'oauth',
      expiresAt: now + 3_600_000,
      oauth: {
        accessToken: 'access',
        refreshToken: 'refresh',
        idToken: null,
        scope: 'user:inference user:profile',
        tokenType: null,
        providerAccountId: 'acct',
        providerEmail: 'user@example.com',
      },
    });
    const api = {
      getAccountEncryptionMode: vi.fn(async () => 'plain' as const),
      getConnectedServiceQuotaSnapshotPlain: vi.fn(async () => null),
      getConnectedServiceCredentialPlain: vi.fn(async () => ({ content: { t: 'plain' as const, v: record } })),
      registerConnectedServiceQuotaSnapshotPlain: vi.fn(async () => {}),
      getConnectedServiceQuotaSnapshotSealed: vi.fn(async () => null),
      getConnectedServiceCredentialSealed: vi.fn(async () => null),
      registerConnectedServiceQuotaSnapshotSealed: vi.fn(async () => {}),
      updateConnectedServiceCredentialHealth: vi.fn(async () => {}),
    } as unknown as QuotaApi;
    const refreshConnectedServiceCredentialForQuota = vi.fn(async () => null);
    const fetcher: ConnectedServiceQuotaFetcher = {
      serviceId: 'claude-subscription',
      fetch: vi.fn(async () => {
        throw Object.assign(new Error('provider auth failed'), {
          quotaFetchErrorCode: 'auth_failure',
          status: 401,
        });
      }),
    };

    const coordinator = new ConnectedServiceQuotasCoordinator({
      api,
      credentials,
      quotaFetchers: [fetcher],
      now: () => now,
      randomBytes: (length: number) => new Uint8Array(length).fill(1),
      failureBackoffMinMs: 10_000,
      failureBackoffMaxMs: 60_000,
      failureBackoffJitterPct: 0,
      refreshConnectedServiceCredentialForQuota,
    });
    coordinator.registerSpawnTarget({
      pid: 123,
      connectedServicesBindingsRaw: {
        v: 1,
        bindingsByServiceId: { 'claude-subscription': { source: 'connected', profileId: 'work' } },
      },
    });

    for (const advanceMs of [0, 10_000, 20_000, 40_000, 60_000]) {
      now += advanceMs;
      await coordinator.tickOnce();
    }

    expect(api.updateConnectedServiceCredentialHealth).toHaveBeenCalledTimes(5);
    expect(api.updateConnectedServiceCredentialHealth).toHaveBeenNthCalledWith(5, {
      serviceId: 'claude-subscription',
      profileId: 'work',
      health: {
        v: 1,
        status: 'needs_reauth',
        reconnectRequired: true,
        lastRefreshAttemptAt: 1_130_000,
        lastRefreshFailureAt: 1_130_000,
        lastRefreshFailureKind: 'provider_401',
        providerHttpStatus: 401,
      },
    });
  });

  it('does not poison credential health when the quota endpoint is missing with 404', async () => {
    const now = 1_000_000;
    const credentials: Credentials = {
      token: 'happy-token',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(9) },
    };
    const record = buildConnectedServiceCredentialRecord({
      now,
      serviceId: 'openai-codex',
      profileId: 'eligible',
      kind: 'oauth',
      expiresAt: now + 3_600_000,
      oauth: {
        accessToken: 'eligible-access',
        refreshToken: 'refresh',
        idToken: null,
        scope: null,
        tokenType: null,
        providerAccountId: 'acct-eligible',
        providerEmail: 'eligible@example.test',
      },
    });
    const api = {
      getAccountEncryptionMode: vi.fn(async () => 'plain' as const),
      getConnectedServiceQuotaSnapshotPlain: vi.fn(async () => null),
      getConnectedServiceCredentialPlain: vi.fn(async () => ({ content: { t: 'plain' as const, v: record } })),
      registerConnectedServiceQuotaSnapshotPlain: vi.fn(async () => {}),
      getConnectedServiceQuotaSnapshotSealed: vi.fn(async () => null),
      getConnectedServiceCredentialSealed: vi.fn(async () => null),
      registerConnectedServiceQuotaSnapshotSealed: vi.fn(async () => {}),
      updateConnectedServiceCredentialHealth: vi.fn(async () => {}),
    } as unknown as QuotaApi;
    const refreshConnectedServiceCredentialForQuota = vi.fn(async () => record);
    const fetcher: ConnectedServiceQuotaFetcher = {
      serviceId: 'openai-codex',
      fetch: vi.fn(async () => {
        throw new ConnectedServiceQuotaFetchError(
          'OpenAI usage endpoint not found',
          {
            status: 404,
            quotaFetchErrorCode: 'auth_failure',
          },
        );
      }),
    };

    const coordinator = new ConnectedServiceQuotasCoordinator({
      api,
      credentials,
      quotaFetchers: [fetcher],
      now: () => now,
      randomBytes: (length: number) => randomBytes(length),
      refreshConnectedServiceCredentialForQuota,
    });
    coordinator.registerSpawnTarget({
      pid: 123,
      connectedServicesBindingsRaw: {
        v: 1,
        bindingsByServiceId: { 'openai-codex': { source: 'connected', profileId: 'eligible' } },
      },
    });

    await coordinator.tickOnce();

    expect(fetcher.fetch).toHaveBeenCalledTimes(1);
    expect(refreshConnectedServiceCredentialForQuota).not.toHaveBeenCalled();
    expect(api.updateConnectedServiceCredentialHealth).not.toHaveBeenCalled();
    expect(api.registerConnectedServiceQuotaSnapshotPlain).not.toHaveBeenCalled();
  });

  it('uses provider Retry-After quota errors as binding backoff', async () => {
    let now = 1_000_000;
    const credentials: Credentials = {
      token: 'happy-token',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(9) },
    };
    const record = buildConnectedServiceCredentialRecord({
      now,
      serviceId: 'openai-codex',
      profileId: 'work',
      kind: 'oauth',
      expiresAt: now + 3_600_000,
      oauth: {
        accessToken: 'access',
        refreshToken: 'refresh',
        idToken: null,
        scope: null,
        tokenType: null,
        providerAccountId: 'acct',
        providerEmail: 'user@example.com',
      },
    });
    const api = {
      getAccountEncryptionMode: vi.fn(async () => 'plain' as const),
      getConnectedServiceQuotaSnapshotPlain: vi.fn(async () => null),
      getConnectedServiceCredentialPlain: vi.fn(async () => ({ content: { t: 'plain' as const, v: record } })),
      registerConnectedServiceQuotaSnapshotPlain: vi.fn(async () => {}),
      getConnectedServiceQuotaSnapshotSealed: vi.fn(async () => null),
      getConnectedServiceCredentialSealed: vi.fn(async () => null),
      registerConnectedServiceQuotaSnapshotSealed: vi.fn(async () => {}),
    } as unknown as QuotaApi;
    const fetcher: ConnectedServiceQuotaFetcher = {
      serviceId: 'openai-codex',
      fetch: vi.fn(async () => {
        throw Object.assign(new Error('provider busy'), { retryAfterMs: 120_000 });
      }),
    };
    const coordinator = new ConnectedServiceQuotasCoordinator({
      api,
      credentials,
      quotaFetchers: [fetcher],
      now: () => now,
      randomBytes: (length: number) => randomBytes(length),
      failureBackoffMinMs: 1,
      failureBackoffMaxMs: 1,
      failureBackoffJitterPct: 0,
    });
    coordinator.registerSpawnTarget({
      pid: 123,
      connectedServicesBindingsRaw: {
        v: 1,
        bindingsByServiceId: { 'openai-codex': { source: 'connected', profileId: 'work' } },
      },
    });

    await coordinator.tickOnce();
    now += 60_000;
    await coordinator.tickOnce();

    expect(fetcher.fetch).toHaveBeenCalledTimes(1);
  });

  it('does not wedge the tick if a fetcher ignores AbortSignal', async () => {
    vi.useFakeTimers();
    const now = 1_000_000;

    const credentials: Credentials = {
      token: 'happy-token',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(9) },
    };
    if (credentials.encryption.type !== 'legacy') throw new Error('fixture');

    const record = buildConnectedServiceCredentialRecord({
      now,
      serviceId: 'openai-codex',
      profileId: 'work',
      kind: 'oauth',
      expiresAt: now + 60_000,
      oauth: {
        accessToken: 'access',
        refreshToken: 'refresh',
        idToken: null,
        scope: null,
        tokenType: null,
        providerAccountId: 'acct',
        providerEmail: 'user@example.com',
      },
    });

    const sealedCredentialCiphertext = sealAccountScopedBlobCiphertext({
      kind: 'connected_service_credential',
      material: { type: 'legacy', secret: credentials.encryption.secret },
      payload: record,
      randomBytes: (length) => randomBytes(length),
    });
    const sealedCredential: SealedCredentialResponse = {
      sealed: { format: 'account_scoped_v1', ciphertext: sealedCredentialCiphertext },
      metadata: { kind: 'oauth' },
    };

    const api = {
      getConnectedServiceQuotaSnapshotSealed: vi.fn(async () => null),
      getConnectedServiceCredentialSealed: vi.fn(async (): Promise<SealedCredentialResponse | null> => sealedCredential),
      registerConnectedServiceQuotaSnapshotSealed: vi.fn(async () => {}),
    } satisfies QuotaApi;

    const fetcher: ConnectedServiceQuotaFetcher = {
      serviceId: 'openai-codex',
      fetch: vi.fn(async (_args: FetchArgs) => new Promise<null>(() => {})),
    };

    const coordinator = new ConnectedServiceQuotasCoordinator({
      api,
      credentials,
      quotaFetchers: [fetcher],
      now: () => now,
      randomBytes: (length: number) => randomBytes(length),
      fetchTimeoutMs: 10,
    });

    coordinator.registerSpawnTarget({
      pid: 123,
      connectedServicesBindingsRaw: {
        v: 1,
        bindingsByServiceId: { 'openai-codex': { source: 'connected', profileId: 'work' } },
      },
    });

    let settled = false;
    const tick = coordinator.tickOnce().finally(() => {
      settled = true;
    });
    void tick;

    await vi.advanceTimersByTimeAsync(50);
    await Promise.resolve();

    expect(settled).toBe(true);
    expect(api.registerConnectedServiceQuotaSnapshotSealed).toHaveBeenCalledTimes(0);
    vi.useRealTimers();
  });

  it('supports dataKey credentials when sealing and opening snapshots', async () => {
    const now = 1_000_000;

    const machineKey = new Uint8Array(32).fill(7);
    const credentials: Credentials = {
      token: 'happy-token',
      encryption: { type: 'dataKey', publicKey: new Uint8Array(32).fill(1), machineKey },
    };

    const record = buildConnectedServiceCredentialRecord({
      now,
      serviceId: 'openai-codex',
      profileId: 'work',
      kind: 'oauth',
      expiresAt: now + 60_000,
      oauth: {
        accessToken: 'access',
        refreshToken: 'refresh',
        idToken: null,
        scope: null,
        tokenType: null,
        providerAccountId: 'acct',
        providerEmail: 'user@example.com',
      },
    });

    const sealedCredentialCiphertext = sealAccountScopedBlobCiphertext({
      kind: 'connected_service_credential',
      material: { type: 'dataKey', machineKey },
      payload: record,
      randomBytes: (length) => randomBytes(length),
    });
    const sealedCredential: SealedCredentialResponse = {
      sealed: { format: 'account_scoped_v1', ciphertext: sealedCredentialCiphertext },
      metadata: { kind: 'oauth' },
    };

	    let uploadedCiphertext: string | null = null;
	    const api = {
	      getConnectedServiceQuotaSnapshotSealed: vi.fn(async () => null),
	      getConnectedServiceCredentialSealed: vi.fn(async (): Promise<SealedCredentialResponse | null> => sealedCredential),
	      registerConnectedServiceQuotaSnapshotSealed: vi.fn(async (params: RegisterArgs) => {
	        uploadedCiphertext = params.sealed.ciphertext;
	      }),
	    } satisfies QuotaApi;

	    const fetcher: ConnectedServiceQuotaFetcher = {
	      serviceId: 'openai-codex',
	      fetch: vi.fn(async ({ record: inputRecord }: FetchArgs): Promise<ConnectedServiceQuotaSnapshotV1 | null> => ({
	        v: 1,
	        serviceId: inputRecord.serviceId,
	        profileId: inputRecord.profileId,
	        fetchedAt: now,
	        staleAfterMs: 300_000,
	        planLabel: 'Pro',
	        accountLabel: 'user@example.com',
	        meters: [],
	      })),
	    };

    const coordinator = new ConnectedServiceQuotasCoordinator({
      api,
      credentials,
      quotaFetchers: [fetcher],
      now: () => now,
      randomBytes: (length: number) => randomBytes(length),
    });

    coordinator.registerSpawnTarget({
      pid: 123,
      connectedServicesBindingsRaw: {
        v: 1,
        bindingsByServiceId: { 'openai-codex': { source: 'connected', profileId: 'work' } },
      },
    });

    await coordinator.tickOnce();

    expect(api.registerConnectedServiceQuotaSnapshotSealed).toHaveBeenCalledTimes(1);
    expect(typeof uploadedCiphertext).toBe('string');

    const opened = openAccountScopedBlobCiphertext({
      kind: 'connected_service_quota_snapshot',
      material: { type: 'dataKey', machineKey },
      ciphertext: uploadedCiphertext ?? '',
    });
    expect(opened?.value).toBeTruthy();
  });

  it('forces a refresh when the server reports refreshRequestedAt newer than fetchedAt', async () => {
    const now = 1_000_000;
    const credentials: Credentials = {
      token: 'happy-token',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(9) },
    };
    if (credentials.encryption.type !== 'legacy') throw new Error('fixture');

    const record = buildConnectedServiceCredentialRecord({
      now,
      serviceId: 'openai-codex',
      profileId: 'work',
      kind: 'oauth',
      expiresAt: now + 60_000,
      oauth: {
        accessToken: 'access',
        refreshToken: 'refresh',
        idToken: null,
        scope: null,
        tokenType: null,
        providerAccountId: 'acct',
        providerEmail: 'user@example.com',
      },
    });
    const sealedCredentialCiphertext = sealAccountScopedBlobCiphertext({
      kind: 'connected_service_credential',
      material: { type: 'legacy', secret: credentials.encryption.secret },
      payload: record,
      randomBytes: (length) => randomBytes(length),
    });
    const sealedCredential: SealedCredentialResponse = {
      sealed: { format: 'account_scoped_v1', ciphertext: sealedCredentialCiphertext },
      metadata: { kind: 'oauth' },
    };
    const existingSnapshot: SealedQuotaSnapshotResponse = {
      sealed: { format: 'account_scoped_v1', ciphertext: 'sealed' },
      metadata: { fetchedAt: now, staleAfterMs: 300_000, status: 'ok', refreshRequestedAt: now + 1 },
    };

    const api = {
      getConnectedServiceQuotaSnapshotSealed: vi.fn(async () => existingSnapshot),
      getConnectedServiceCredentialSealed: vi.fn(async () => sealedCredential),
      registerConnectedServiceQuotaSnapshotSealed: vi.fn(),
    } satisfies QuotaApi;

    const fetcher: ConnectedServiceQuotaFetcher = { serviceId: 'openai-codex', fetch: vi.fn(async (_args: FetchArgs) => null) };

    const coordinator = new ConnectedServiceQuotasCoordinator({
      api,
      credentials,
      quotaFetchers: [fetcher],
      now: () => now,
      randomBytes: (length: number) => randomBytes(length),
    });

    coordinator.registerSpawnTarget({
      pid: 123,
      connectedServicesBindingsRaw: {
        v: 1,
        bindingsByServiceId: { 'openai-codex': { source: 'connected', profileId: 'work' } },
      },
    });

    await coordinator.tickOnce();
    expect(fetcher.fetch).toHaveBeenCalledTimes(1);
  });

  it('aborts quota fetchers that exceed the timeout', async () => {
    vi.useFakeTimers();
    const now = 1_000_000;

    const credentials: Credentials = {
      token: 'happy-token',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(9) },
    };
    if (credentials.encryption.type !== 'legacy') throw new Error('fixture');

    const record = buildConnectedServiceCredentialRecord({
      now,
      serviceId: 'openai-codex',
      profileId: 'work',
      kind: 'oauth',
      expiresAt: now + 60_000,
      oauth: {
        accessToken: 'access',
        refreshToken: 'refresh',
        idToken: null,
        scope: null,
        tokenType: null,
        providerAccountId: 'acct',
        providerEmail: 'user@example.com',
      },
    });

	    const sealedCredentialCiphertext = sealAccountScopedBlobCiphertext({
	      kind: 'connected_service_credential',
	      material: { type: 'legacy', secret: credentials.encryption.secret },
	      payload: record,
	      randomBytes: (length) => randomBytes(length),
	    });
	    const sealedCredential: SealedCredentialResponse = {
	      sealed: { format: 'account_scoped_v1', ciphertext: sealedCredentialCiphertext },
	      metadata: { kind: 'oauth' },
	    };

	    const api = {
	      getConnectedServiceQuotaSnapshotSealed: vi.fn(async () => null),
	      getConnectedServiceCredentialSealed: vi.fn(async (): Promise<SealedCredentialResponse | null> => sealedCredential),
	      registerConnectedServiceQuotaSnapshotSealed: vi.fn(),
	    } satisfies QuotaApi;

	    const fetcher: ConnectedServiceQuotaFetcher = {
	      serviceId: 'openai-codex',
	      fetch: vi.fn(async ({ signal }: FetchArgs) => {
	        await new Promise<void>((_resolve, reject) => {
	          signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
	        });
	        return null;
	      }),
	    };

	    const coordinator = new ConnectedServiceQuotasCoordinator({
	      api,
	      credentials,
	      quotaFetchers: [fetcher],
	      now: () => now,
	      randomBytes: (length: number) => randomBytes(length),
	      fetchTimeoutMs: 5,
	    });

    coordinator.registerSpawnTarget({
      pid: 123,
      connectedServicesBindingsRaw: {
        v: 1,
        bindingsByServiceId: { 'openai-codex': { source: 'connected', profileId: 'work' } },
      },
    });

    const pending = coordinator.tickOnce();
    await vi.advanceTimersByTimeAsync(10);
    await expect(pending).resolves.toBeUndefined();
    expect(fetcher.fetch).toHaveBeenCalledTimes(1);
  });

  it('skips fetching when the server snapshot is still fresh', async () => {
    const now = 1_000_000;
	    const credentials: Credentials = {
	      token: 'happy-token',
	      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(9) },
	    };
	    if (credentials.encryption.type !== 'legacy') throw new Error('fixture');

	    const existingSnapshot: SealedQuotaSnapshotResponse = {
	      sealed: { format: 'account_scoped_v1', ciphertext: 'sealed' },
	      metadata: { fetchedAt: now, staleAfterMs: 300_000, status: 'ok' },
	    };

	    const api = {
	      getConnectedServiceQuotaSnapshotSealed: vi.fn(async (): Promise<SealedQuotaSnapshotResponse | null> => existingSnapshot),
	      getConnectedServiceCredentialSealed: vi.fn(async () => null),
	      registerConnectedServiceQuotaSnapshotSealed: vi.fn(),
	    } satisfies QuotaApi;

	    const fetcher: ConnectedServiceQuotaFetcher = { serviceId: 'openai-codex', fetch: vi.fn(async (_args: FetchArgs) => null) };

	    const coordinator = new ConnectedServiceQuotasCoordinator({
	      api,
	      credentials,
	      quotaFetchers: [fetcher],
	      now: () => now,
	      randomBytes: (length: number) => randomBytes(length),
	    });

    coordinator.registerSpawnTarget({
      pid: 123,
      connectedServicesBindingsRaw: {
        v: 1,
        bindingsByServiceId: { 'openai-codex': { source: 'connected', profileId: 'work' } },
      },
    });

    await coordinator.tickOnce();
    expect(fetcher.fetch).not.toHaveBeenCalled();
    expect(api.registerConnectedServiceQuotaSnapshotSealed).not.toHaveBeenCalled();
  });

  it('uses a shared lease so contending daemons do not duplicate stale quota fetches', async () => {
    const now = 1_000_000;
    const credentials: Credentials = {
      token: 'happy-token',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(9) },
    };

    const record = buildConnectedServiceCredentialRecord({
      now,
      serviceId: 'openai-codex',
      profileId: 'work',
      kind: 'oauth',
      expiresAt: now + 60_000,
      oauth: {
        accessToken: 'access',
        refreshToken: 'refresh',
        idToken: null,
        scope: null,
        tokenType: null,
        providerAccountId: 'acct',
        providerEmail: 'user@example.com',
      },
    });

    const staleSnapshot: ConnectedServiceQuotaSnapshotV1 = {
      v: 1,
      serviceId: 'openai-codex',
      profileId: 'work',
      fetchedAt: now - 60_000,
      staleAfterMs: 1_000,
      planLabel: 'Pro',
      accountLabel: 'user@example.com',
      meters: [],
    };
    const freshSnapshot: ConnectedServiceQuotaSnapshotV1 = {
      ...staleSnapshot,
      fetchedAt: now,
      meters: [
        {
          meterId: 'weekly',
          label: 'Weekly',
          used: 1,
          limit: 10,
          unit: 'count',
          utilizationPct: 10,
          resetsAt: now + 60_000,
          status: 'ok',
          details: {},
        },
      ],
    };

    let serverSnapshot: ConnectedServiceQuotaSnapshotV1 = staleSnapshot;
    let leaseOwner: string | null = null;
    let releaseFirstFetch: () => void = () => {};
    let releaseSleep: () => void = () => {};

    const apiWithLease = {
      getAccountEncryptionMode: vi.fn(async () => 'plain' as const),
      getConnectedServiceQuotaSnapshotPlain: vi.fn(async () => ({
        content: { t: 'plain' as const, v: serverSnapshot },
        metadata: {
          fetchedAt: serverSnapshot.fetchedAt,
          staleAfterMs: serverSnapshot.staleAfterMs,
          status: 'ok' as const,
        },
      })),
      getConnectedServiceCredentialPlain: vi.fn(async () => ({ content: { t: 'plain' as const, v: record } })),
      registerConnectedServiceQuotaSnapshotPlain: vi.fn(async (params) => {
        serverSnapshot = params.content.v;
      }),
      getConnectedServiceQuotaSnapshotSealed: vi.fn(async () => null),
      getConnectedServiceCredentialSealed: vi.fn(async () => null),
      registerConnectedServiceQuotaSnapshotSealed: vi.fn(async () => {}),
      acquireConnectedServiceRefreshLease: vi.fn(async (params: Readonly<{ ownerId?: string; leaseMs: number }>) => {
        const ownerId = params.ownerId ?? 'legacy-owner';
        if (!leaseOwner || leaseOwner === ownerId) {
          leaseOwner = ownerId;
          return { acquired: true, leaseUntil: now + params.leaseMs };
        }
        return { acquired: false, leaseUntil: now + 50 };
      }),
    };
    const api: QuotaApi = apiWithLease;

    let fetchCallCount = 0;
    const fetchMock = vi.fn(async () => {
      fetchCallCount += 1;
      if (fetchCallCount === 1) {
        await new Promise<void>((resolve) => {
          releaseFirstFetch = resolve;
        });
        return freshSnapshot;
      }
      return freshSnapshot;
    });
    const fetcher: ConnectedServiceQuotaFetcher = {
      serviceId: 'openai-codex',
      fetch: fetchMock,
    };

    const sleepMs = vi.fn(async () => {
      await new Promise<void>((resolve) => {
        releaseSleep = resolve;
      });
    });

    const common = {
      api,
      credentials,
      quotaFetchers: [fetcher],
      now: () => now,
      randomBytes: (length: number) => randomBytes(length),
      quotaFetchLeaseMs: 10_000,
      quotaFetchLeaseContentionWaitMaxMs: 100,
      sleepMs,
    };
    const coordinatorA = new ConnectedServiceQuotasCoordinator({
      ...common,
      machineIdProvider: () => 'machine-1',
      ownerIdProvider: () => 'machine-1:daemon-a',
    });
    const coordinatorB = new ConnectedServiceQuotasCoordinator({
      ...common,
      machineIdProvider: () => 'machine-1',
      ownerIdProvider: () => 'machine-1:daemon-b',
    });

    for (const coordinator of [coordinatorA, coordinatorB]) {
      coordinator.registerSpawnTarget({
        pid: coordinator === coordinatorA ? 123 : 456,
        connectedServicesBindingsRaw: {
          v: 1,
          bindingsByServiceId: { 'openai-codex': { source: 'connected', profileId: 'work' } },
        },
      });
    }

    const tickA = coordinatorA.tickOnce();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const tickB = coordinatorB.tickOnce();
    await vi.waitFor(() => {
      if (sleepMs.mock.calls.length === 0 && fetchMock.mock.calls.length < 2) {
        throw new Error('waiting for quota lease contention');
      }
    });

    releaseFirstFetch();
    await tickA;
    releaseSleep();
    await tickB;

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(apiWithLease.registerConnectedServiceQuotaSnapshotPlain).toHaveBeenCalledTimes(1);
    expect(apiWithLease.getConnectedServiceQuotaSnapshotPlain).toHaveBeenCalledTimes(3);
    expect(sleepMs).toHaveBeenCalledWith(50);
  });

  it('backs off instead of fetching provider quotas when lease acquisition fails', async () => {
    let now = 1_000_000;
    const credentials: Credentials = {
      token: 'happy-token',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(9) },
    };

    const record = buildConnectedServiceCredentialRecord({
      now,
      serviceId: 'openai-codex',
      profileId: 'work',
      kind: 'oauth',
      expiresAt: now + 60_000,
      oauth: {
        accessToken: 'access',
        refreshToken: 'refresh',
        idToken: null,
        scope: null,
        tokenType: null,
        providerAccountId: 'acct',
        providerEmail: 'user@example.com',
      },
    });

    const apiWithFailingLease = {
      getAccountEncryptionMode: vi.fn(async () => 'plain' as const),
      getConnectedServiceQuotaSnapshotPlain: vi.fn(async () => null),
      getConnectedServiceCredentialPlain: vi.fn(async () => ({ content: { t: 'plain' as const, v: record } })),
      registerConnectedServiceQuotaSnapshotPlain: vi.fn(async () => {}),
      getConnectedServiceQuotaSnapshotSealed: vi.fn(async () => null),
      getConnectedServiceCredentialSealed: vi.fn(async () => null),
      registerConnectedServiceQuotaSnapshotSealed: vi.fn(async () => {}),
      acquireConnectedServiceRefreshLease: vi.fn(async () => {
        throw new Error('lease service unavailable');
      }),
    };
    const api: QuotaApi = apiWithFailingLease;

    const fetcher: ConnectedServiceQuotaFetcher = {
      serviceId: 'openai-codex',
      fetch: vi.fn(async (): Promise<ConnectedServiceQuotaSnapshotV1 | null> => ({
        v: 1,
        serviceId: 'openai-codex',
        profileId: 'work',
        fetchedAt: now,
        staleAfterMs: 300_000,
        planLabel: 'Pro',
        accountLabel: null,
        meters: [],
      })),
    };

    const coordinator = new ConnectedServiceQuotasCoordinator({
      api,
      credentials,
      quotaFetchers: [fetcher],
      now: () => now,
      randomBytes: (length: number) => new Uint8Array(length).fill(1),
      machineIdProvider: () => 'machine-1',
      ownerIdProvider: () => 'machine-1:daemon-a',
      failureBackoffMinMs: 10_000,
      failureBackoffMaxMs: 60_000,
      failureBackoffJitterPct: 0,
    });

    coordinator.registerSpawnTarget({
      pid: 123,
      connectedServicesBindingsRaw: {
        v: 1,
        bindingsByServiceId: { 'openai-codex': { source: 'connected', profileId: 'work' } },
      },
    });

    await coordinator.tickOnce();
    await coordinator.tickOnce();

    expect(fetcher.fetch).not.toHaveBeenCalled();
    expect(apiWithFailingLease.getConnectedServiceCredentialPlain).not.toHaveBeenCalled();
    expect(apiWithFailingLease.acquireConnectedServiceRefreshLease).toHaveBeenCalledTimes(1);

    now += 10_000;
    await coordinator.tickOnce();
    expect(apiWithFailingLease.acquireConnectedServiceRefreshLease).toHaveBeenCalledTimes(2);
  });

  it('does not throw when the fetcher fails', async () => {
    const now = 1_000_000;
    const credentials: Credentials = {
      token: 'happy-token',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(9) },
    };
    if (credentials.encryption.type !== 'legacy') throw new Error('fixture');

    const record = buildConnectedServiceCredentialRecord({
      now,
      serviceId: 'openai-codex',
      profileId: 'work',
      kind: 'oauth',
      expiresAt: now + 60_000,
      oauth: {
        accessToken: 'access',
        refreshToken: 'refresh',
        idToken: null,
        scope: null,
        tokenType: null,
        providerAccountId: 'acct',
        providerEmail: 'user@example.com',
      },
    });

	    const sealedCredentialCiphertext = sealAccountScopedBlobCiphertext({
	      kind: 'connected_service_credential',
	      material: { type: 'legacy', secret: credentials.encryption.secret },
	      payload: record,
	      randomBytes: (length) => randomBytes(length),
	    });
	    const sealedCredential: SealedCredentialResponse = {
	      sealed: { format: 'account_scoped_v1', ciphertext: sealedCredentialCiphertext },
	      metadata: { kind: 'oauth' },
	    };

	    const api = {
	      getConnectedServiceQuotaSnapshotSealed: vi.fn(async () => null),
	      getConnectedServiceCredentialSealed: vi.fn(async (): Promise<SealedCredentialResponse | null> => sealedCredential),
	      registerConnectedServiceQuotaSnapshotSealed: vi.fn(),
	    } satisfies QuotaApi;

	    const fetcher: ConnectedServiceQuotaFetcher = {
	      serviceId: 'openai-codex',
	      fetch: vi.fn(async (_args: FetchArgs) => {
	        throw new Error('boom');
	      }),
	    };

	    const coordinator = new ConnectedServiceQuotasCoordinator({
	      api,
	      credentials,
	      quotaFetchers: [fetcher],
	      now: () => now,
	      randomBytes: (length: number) => randomBytes(length),
	    });

    coordinator.registerSpawnTarget({
      pid: 123,
      connectedServicesBindingsRaw: {
        v: 1,
        bindingsByServiceId: { 'openai-codex': { source: 'connected', profileId: 'work' } },
      },
    });

    await expect(coordinator.tickOnce()).resolves.toBeUndefined();
    expect(api.registerConnectedServiceQuotaSnapshotSealed).not.toHaveBeenCalled();
  });

  it('applies a failure backoff window per binding', async () => {
    let now = 1_000_000;

    const credentials: Credentials = {
      token: 'happy-token',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(9) },
    };
    if (credentials.encryption.type !== 'legacy') throw new Error('fixture');

    const record = buildConnectedServiceCredentialRecord({
      now,
      serviceId: 'openai-codex',
      profileId: 'work',
      kind: 'oauth',
      expiresAt: now + 60_000,
      oauth: {
        accessToken: 'access',
        refreshToken: 'refresh',
        idToken: null,
        scope: null,
        tokenType: null,
        providerAccountId: 'acct',
        providerEmail: 'user@example.com',
      },
    });

    const sealedCredentialCiphertext = sealAccountScopedBlobCiphertext({
      kind: 'connected_service_credential',
      material: { type: 'legacy', secret: credentials.encryption.secret },
      payload: record,
      randomBytes: (length) => randomBytes(length),
    });
    const sealedCredential: SealedCredentialResponse = {
      sealed: { format: 'account_scoped_v1', ciphertext: sealedCredentialCiphertext },
      metadata: { kind: 'oauth' },
    };

    const api = {
      getConnectedServiceQuotaSnapshotSealed: vi.fn(async () => null),
      getConnectedServiceCredentialSealed: vi.fn(async (): Promise<SealedCredentialResponse | null> => sealedCredential),
      registerConnectedServiceQuotaSnapshotSealed: vi.fn(async () => {}),
    } satisfies QuotaApi;
    (api as unknown as { listConnectedServiceProfiles: unknown }).listConnectedServiceProfiles = vi.fn(async () => ({
      serviceId: 'openai-codex',
      profiles: [{ profileId: 'work', status: 'connected' }],
    }));

    const fetcher: ConnectedServiceQuotaFetcher = {
      serviceId: 'openai-codex',
      fetch: vi.fn(async () => {
        throw new Error('provider down');
      }),
    };

    const coordinator = new ConnectedServiceQuotasCoordinator({
      api,
      credentials,
      quotaFetchers: [fetcher],
      now: () => now,
      randomBytes: (length: number) => new Uint8Array(length).fill(1),
      failureBackoffMinMs: 10_000,
      failureBackoffMaxMs: 60_000,
      failureBackoffJitterPct: 0,
      discoveryEnabled: false,
    } as unknown as ConstructorParameters<typeof ConnectedServiceQuotasCoordinator>[0]);

    coordinator.registerSpawnTarget({
      pid: 123,
      connectedServicesBindingsRaw: {
        v: 1,
        bindingsByServiceId: { 'openai-codex': { source: 'connected', profileId: 'work' } },
      },
    });

    await coordinator.tickOnce();
    await coordinator.tickOnce();

    expect(fetcher.fetch).toHaveBeenCalledTimes(1);

    now += 10_000;
    await coordinator.tickOnce();
    expect(fetcher.fetch).toHaveBeenCalledTimes(2);
  });

  it('applies failure backoff even when refreshRequestedAt remains newer than fetchedAt', async () => {
    let now = 1_000_000;

    const credentials: Credentials = {
      token: 'happy-token',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(9) },
    };
    if (credentials.encryption.type !== 'legacy') throw new Error('fixture');

    const record = buildConnectedServiceCredentialRecord({
      now,
      serviceId: 'openai-codex',
      profileId: 'work',
      kind: 'oauth',
      expiresAt: now + 60_000,
      oauth: {
        accessToken: 'access',
        refreshToken: 'refresh',
        idToken: null,
        scope: null,
        tokenType: null,
        providerAccountId: 'acct',
        providerEmail: 'user@example.com',
      },
    });

    const sealedCredentialCiphertext = sealAccountScopedBlobCiphertext({
      kind: 'connected_service_credential',
      material: { type: 'legacy', secret: credentials.encryption.secret },
      payload: record,
      randomBytes: (length) => randomBytes(length),
    });
    const sealedCredential: SealedCredentialResponse = {
      sealed: { format: 'account_scoped_v1', ciphertext: sealedCredentialCiphertext },
      metadata: { kind: 'oauth' },
    };
    const existingSnapshot: SealedQuotaSnapshotResponse = {
      sealed: { format: 'account_scoped_v1', ciphertext: 'sealed' },
      metadata: { fetchedAt: now, staleAfterMs: 300_000, status: 'ok', refreshRequestedAt: now + 1 },
    };

    const api = {
      getConnectedServiceQuotaSnapshotSealed: vi.fn(async (): Promise<SealedQuotaSnapshotResponse | null> => existingSnapshot),
      getConnectedServiceCredentialSealed: vi.fn(async (): Promise<SealedCredentialResponse | null> => sealedCredential),
      registerConnectedServiceQuotaSnapshotSealed: vi.fn(async () => {}),
    } satisfies QuotaApi;

    const fetcher: ConnectedServiceQuotaFetcher = {
      serviceId: 'openai-codex',
      fetch: vi.fn(async () => {
        throw new Error('provider down');
      }),
    };

    const coordinator = new ConnectedServiceQuotasCoordinator({
      api,
      credentials,
      quotaFetchers: [fetcher],
      now: () => now,
      randomBytes: (length: number) => new Uint8Array(length).fill(1),
      failureBackoffMinMs: 10_000,
      failureBackoffMaxMs: 60_000,
      failureBackoffJitterPct: 0,
      discoveryEnabled: false,
    } as unknown as ConstructorParameters<typeof ConnectedServiceQuotasCoordinator>[0]);

    coordinator.registerSpawnTarget({
      pid: 123,
      connectedServicesBindingsRaw: {
        v: 1,
        bindingsByServiceId: { 'openai-codex': { source: 'connected', profileId: 'work' } },
      },
    });

    await coordinator.tickOnce();
    await coordinator.tickOnce();
    expect(fetcher.fetch).toHaveBeenCalledTimes(1);

    now += 10_000;
    await coordinator.tickOnce();
    expect(fetcher.fetch).toHaveBeenCalledTimes(2);
  });

  it('can discover connected profiles when enabled', async () => {
    const now = 1_000_000;

    const credentials: Credentials = {
      token: 'happy-token',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(9) },
    };
    if (credentials.encryption.type !== 'legacy') throw new Error('fixture');

    const record = buildConnectedServiceCredentialRecord({
      now,
      serviceId: 'openai-codex',
      profileId: 'work',
      kind: 'oauth',
      expiresAt: now + 60_000,
      oauth: {
        accessToken: 'access',
        refreshToken: 'refresh',
        idToken: null,
        scope: null,
        tokenType: null,
        providerAccountId: 'acct',
        providerEmail: 'user@example.com',
      },
    });

    const sealedCredentialCiphertext = sealAccountScopedBlobCiphertext({
      kind: 'connected_service_credential',
      material: { type: 'legacy', secret: credentials.encryption.secret },
      payload: record,
      randomBytes: (length) => randomBytes(length),
    });
    const sealedCredential: SealedCredentialResponse = {
      sealed: { format: 'account_scoped_v1', ciphertext: sealedCredentialCiphertext },
      metadata: { kind: 'oauth' },
    };

    let uploadedCiphertext: string | null = null;
    const api = {
      getConnectedServiceQuotaSnapshotSealed: vi.fn(async () => null),
      getConnectedServiceCredentialSealed: vi.fn(async (): Promise<SealedCredentialResponse | null> => sealedCredential),
      registerConnectedServiceQuotaSnapshotSealed: vi.fn(async (params: RegisterArgs) => {
        uploadedCiphertext = params.sealed.ciphertext;
      }),
    } satisfies QuotaApi;
    (api as unknown as { listConnectedServiceProfiles: unknown }).listConnectedServiceProfiles = vi.fn(async () => ({
      serviceId: 'openai-codex',
      profiles: [{ profileId: 'work', status: 'connected' }],
    }));

    const fetcher: ConnectedServiceQuotaFetcher = {
      serviceId: 'openai-codex',
      fetch: vi.fn(async (): Promise<ConnectedServiceQuotaSnapshotV1 | null> => ({
        v: 1,
        serviceId: 'openai-codex',
        profileId: 'work',
        fetchedAt: now,
        staleAfterMs: 300_000,
        planLabel: 'Pro',
        accountLabel: null,
        meters: [],
      })),
    };

    const coordinator = new ConnectedServiceQuotasCoordinator({
      api,
      credentials,
      quotaFetchers: [fetcher],
      now: () => now,
      randomBytes: (length: number) => randomBytes(length),
      discoveryEnabled: true,
      discoveryIntervalMs: 1,
      failureBackoffJitterPct: 0,
    } as unknown as ConstructorParameters<typeof ConnectedServiceQuotasCoordinator>[0]);

    await coordinator.tickOnce();

    expect((api as any).listConnectedServiceProfiles).toHaveBeenCalled();
    expect(fetcher.fetch).toHaveBeenCalledTimes(1);
    expect(typeof uploadedCiphertext).toBe('string');
  });

  it('queues in-band quota snapshots without invoking provider polling', async () => {
    let now = 1_000_000;
    const credentials: Credentials = {
      token: 'happy-token',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(9) },
    };
    const api = {
      getAccountEncryptionMode: vi.fn(async () => 'plain' as const),
      getConnectedServiceQuotaSnapshotPlain: vi.fn(async () => null),
      getConnectedServiceCredentialPlain: vi.fn(async () => null),
      registerConnectedServiceQuotaSnapshotPlain: vi.fn(async () => {}),
      getConnectedServiceQuotaSnapshotSealed: vi.fn(async () => null),
      getConnectedServiceCredentialSealed: vi.fn(async () => null),
      registerConnectedServiceQuotaSnapshotSealed: vi.fn(async () => {}),
    } as unknown as QuotaApi;
    const fetcher: ConnectedServiceQuotaFetcher = {
      serviceId: 'openai-codex',
      fetch: vi.fn(),
    };
    const coordinator = new ConnectedServiceQuotasCoordinator({
      api,
      credentials,
      quotaFetchers: [fetcher],
      now: () => now,
      randomBytes: (length: number) => randomBytes(length),
      quotaPersistenceMinIntervalMs: 5_000,
    });

    await expect(coordinator.recordInBandQuotaSnapshot({
      serviceId: 'openai-codex',
      profileId: 'work',
      snapshot: {
        v: 1,
        serviceId: 'openai-codex',
        profileId: 'work',
        fetchedAt: now,
        staleAfterMs: 300_000,
        planLabel: 'pro',
        accountLabel: null,
        meters: [
          {
            meterId: 'primary',
            label: 'Primary',
            used: null,
            limit: null,
            unit: 'unknown',
            utilizationPct: 88,
            resetsAt: null,
            status: 'ok',
            details: {},
          },
        ],
      },
    })).resolves.toEqual({ status: 'enqueued', enqueue: 'accepted' });

    expect(fetcher.fetch).not.toHaveBeenCalled();
    await coordinator.flushInBandQuotaPersistence(1_000);
    expect((api as any).registerConnectedServiceQuotaSnapshotPlain).toHaveBeenCalledWith(expect.objectContaining({
      serviceId: 'openai-codex',
      profileId: 'work',
      metadata: expect.objectContaining({ fetchedAt: now, staleAfterMs: 300_000, status: 'ok' }),
    }));
  });

  it('rejects in-band quota snapshots whose embedded service id does not match the write key', async () => {
    const now = 1_000_000;
    const credentials: Credentials = {
      token: 'happy-token',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(9) },
    };
    const api = {
      getAccountEncryptionMode: vi.fn(async () => 'plain' as const),
      getConnectedServiceQuotaSnapshotPlain: vi.fn(async () => null),
      getConnectedServiceCredentialPlain: vi.fn(async () => null),
      registerConnectedServiceQuotaSnapshotPlain: vi.fn(async () => {}),
      getConnectedServiceQuotaSnapshotSealed: vi.fn(async () => null),
      getConnectedServiceCredentialSealed: vi.fn(async () => null),
      registerConnectedServiceQuotaSnapshotSealed: vi.fn(async () => {}),
    } as unknown as QuotaApi;
    const coordinator = new ConnectedServiceQuotasCoordinator({
      api,
      credentials,
      quotaFetchers: [],
      now: () => now,
      randomBytes: (length: number) => randomBytes(length),
    });

    await expect(coordinator.recordInBandQuotaSnapshot({
      serviceId: 'openai-codex',
      profileId: 'work',
      snapshot: {
        v: 1,
        serviceId: 'claude-subscription',
        profileId: 'native:1234567890abcdef1234567890abcdef1234567890abcdef',
        fetchedAt: now,
        staleAfterMs: 300_000,
        providerId: 'claude',
        planLabel: null,
        accountLabel: null,
        meters: [],
      },
    })).resolves.toEqual({ status: 'suppressed', reason: 'service_id_mismatch' });

    await coordinator.flushInBandQuotaPersistence(1_000);
    expect((api as any).registerConnectedServiceQuotaSnapshotPlain).not.toHaveBeenCalled();
    expect((api as any).registerConnectedServiceQuotaSnapshotSealed).not.toHaveBeenCalled();
  });

  it('does not persist unchanged in-band quota snapshots every five seconds by default', async () => {
    let now = 1_000_000;
    const credentials: Credentials = {
      token: 'happy-token',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(9) },
    };
    const api = {
      getAccountEncryptionMode: vi.fn(async () => 'plain' as const),
      getConnectedServiceQuotaSnapshotPlain: vi.fn(async () => null),
      getConnectedServiceCredentialPlain: vi.fn(async () => null),
      registerConnectedServiceQuotaSnapshotPlain: vi.fn(async () => {}),
      getConnectedServiceQuotaSnapshotSealed: vi.fn(async () => null),
      getConnectedServiceCredentialSealed: vi.fn(async () => null),
      registerConnectedServiceQuotaSnapshotSealed: vi.fn(async () => {}),
    } as unknown as QuotaApi;
    const coordinator = new ConnectedServiceQuotasCoordinator({
      api,
      credentials,
      quotaFetchers: [],
      now: () => now,
      randomBytes: (length: number) => randomBytes(length),
    });
    const makeSnapshot = (fetchedAt: number): ConnectedServiceQuotaSnapshotV1 => ({
      v: 1,
      serviceId: 'openai-codex',
      profileId: 'work',
      fetchedAt,
      staleAfterMs: 300_000,
      planLabel: 'pro',
      accountLabel: null,
      meters: [{
        meterId: 'primary',
        label: 'Primary',
        used: 50,
        limit: 100,
        unit: 'requests',
        utilizationPct: 50,
        remainingPct: 50,
        resetsAt: 10_000,
        status: 'ok',
        details: {},
      }],
    });

    await expect(coordinator.recordInBandQuotaSnapshot({
      serviceId: 'openai-codex',
      profileId: 'work',
      snapshot: makeSnapshot(now),
    })).resolves.toEqual({ status: 'enqueued', enqueue: 'accepted' });
    await coordinator.flushInBandQuotaPersistence(1_000);

    now += 6_000;
    await expect(coordinator.recordInBandQuotaSnapshot({
      serviceId: 'openai-codex',
      profileId: 'work',
      snapshot: makeSnapshot(now),
    })).resolves.toEqual({ status: 'suppressed', reason: 'unchanged' });
    await coordinator.flushInBandQuotaPersistence(1_000);

    expect((api as any).registerConnectedServiceQuotaSnapshotPlain).toHaveBeenCalledTimes(1);
  });

  it('keeps a server refresh marker material after a background read so the next in-band snapshot persists', async () => {
    let now = 1_000_000;
    const credentials: Credentials = {
      token: 'happy-token',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(9) },
    };
    const makeSnapshot = (fetchedAt: number): ConnectedServiceQuotaSnapshotV1 => ({
      v: 1,
      serviceId: 'openai-codex',
      profileId: 'work',
      fetchedAt,
      staleAfterMs: 300_000,
      planLabel: 'pro',
      accountLabel: null,
      meters: [{
        meterId: 'primary',
        label: 'Primary',
        used: 50,
        limit: 100,
        unit: 'requests',
        utilizationPct: 50,
        remainingPct: 50,
        resetsAt: 10_000,
        status: 'ok',
        details: {},
      }],
    });
    const oldSnapshot = makeSnapshot(now);
    const refreshRequestedAt = now + 500;
    const record = buildConnectedServiceCredentialRecord({
      now,
      serviceId: 'openai-codex',
      profileId: 'work',
      kind: 'oauth',
      expiresAt: now + 60_000,
      oauth: {
        accessToken: 'access',
        refreshToken: 'refresh',
        idToken: null,
        scope: null,
        tokenType: null,
        providerAccountId: 'acct',
        providerEmail: 'user@example.com',
      },
    });
    const api = {
      getAccountEncryptionMode: vi.fn(async () => 'plain' as const),
      getConnectedServiceQuotaSnapshotPlain: vi.fn(async () => ({
        content: { t: 'plain' as const, v: oldSnapshot },
        metadata: {
          fetchedAt: oldSnapshot.fetchedAt,
          staleAfterMs: oldSnapshot.staleAfterMs,
          status: 'ok' as const,
          refreshRequestedAt,
        },
      })),
      getConnectedServiceCredentialPlain: vi.fn(async () => ({ content: { t: 'plain' as const, v: record } })),
      registerConnectedServiceQuotaSnapshotPlain: vi.fn(async () => {}),
      getConnectedServiceQuotaSnapshotSealed: vi.fn(async () => null),
      getConnectedServiceCredentialSealed: vi.fn(async () => null),
      registerConnectedServiceQuotaSnapshotSealed: vi.fn(async () => {}),
    } as unknown as QuotaApi;
    const fetcher: ConnectedServiceQuotaFetcher = {
      serviceId: 'openai-codex',
      fetch: vi.fn(async () => null),
    };
    const coordinator = new ConnectedServiceQuotasCoordinator({
      api,
      credentials,
      quotaFetchers: [fetcher],
      now: () => now,
      randomBytes: (length: number) => randomBytes(length),
      discoveryEnabled: false,
    });
    coordinator.registerSpawnTarget({
      pid: 123,
      connectedServicesBindingsRaw: {
        v: 1,
        bindingsByServiceId: { 'openai-codex': { source: 'connected', profileId: 'work' } },
      },
    });

    await coordinator.recordInBandQuotaSnapshot({
      serviceId: 'openai-codex',
      profileId: 'work',
      snapshot: oldSnapshot,
    });
    await coordinator.flushInBandQuotaPersistence(1_000);

    await coordinator.tickOnce();

    now = refreshRequestedAt + 1;
    await expect(coordinator.recordInBandQuotaSnapshot({
      serviceId: 'openai-codex',
      profileId: 'work',
      snapshot: makeSnapshot(now),
    })).resolves.toEqual({ status: 'enqueued', enqueue: 'accepted' });
    await coordinator.flushInBandQuotaPersistence(1_000);

    expect((api as any).registerConnectedServiceQuotaSnapshotPlain).toHaveBeenCalledTimes(2);
  });

  it('moves in-band quota persistence to the hydrated account scope after credentials gain a JWT', async () => {
    let now = 1_000_000;
    const credentials: Credentials = {
      token: '',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(9) },
    };
    const api = {
      getAccountEncryptionMode: vi.fn(async () => 'plain' as const),
      getConnectedServiceQuotaSnapshotPlain: vi.fn(async () => null),
      getConnectedServiceCredentialPlain: vi.fn(async () => null),
      registerConnectedServiceQuotaSnapshotPlain: vi.fn(async () => {}),
      getConnectedServiceQuotaSnapshotSealed: vi.fn(async () => null),
      getConnectedServiceCredentialSealed: vi.fn(async () => null),
      registerConnectedServiceQuotaSnapshotSealed: vi.fn(async () => {}),
    } as unknown as QuotaApi;
    const coordinator = new ConnectedServiceQuotasCoordinator({
      api,
      credentials,
      quotaFetchers: [],
      now: () => now,
      randomBytes: (length: number) => randomBytes(length),
    });
    const makeSnapshot = (fetchedAt: number): ConnectedServiceQuotaSnapshotV1 => ({
      v: 1,
      serviceId: 'openai-codex',
      profileId: 'work',
      fetchedAt,
      staleAfterMs: 300_000,
      planLabel: 'pro',
      accountLabel: null,
      meters: [{
        meterId: 'primary',
        label: 'Primary',
        used: 50,
        limit: 100,
        unit: 'requests',
        utilizationPct: 50,
        remainingPct: 50,
        resetsAt: 10_000,
        status: 'ok',
        details: {},
      }],
    });

    await expect(coordinator.recordInBandQuotaSnapshot({
      serviceId: 'openai-codex',
      profileId: 'work',
      snapshot: makeSnapshot(now),
    })).resolves.toEqual({ status: 'enqueued', enqueue: 'accepted' });
    await coordinator.flushInBandQuotaPersistence(1_000);

    credentials.token = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJxdW90YS1hY2N0In0.signaturepart';
    now += 1_000;

    await expect(coordinator.recordInBandQuotaSnapshot({
      serviceId: 'openai-codex',
      profileId: 'work',
      snapshot: makeSnapshot(now),
    })).resolves.toEqual({ status: 'enqueued', enqueue: 'accepted' });
    await coordinator.flushInBandQuotaPersistence(1_000);

    expect((api as any).registerConnectedServiceQuotaSnapshotPlain).toHaveBeenCalledTimes(2);
  });

  it('coalesces in-band quota snapshots and flushes the latest payload', async () => {
    let now = 1_000_000;
    const credentials: Credentials = {
      token: 'happy-token',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(9) },
    };
    const writtenRemaining: number[] = [];
    const api = {
      getAccountEncryptionMode: vi.fn(async () => 'plain' as const),
      getConnectedServiceQuotaSnapshotPlain: vi.fn(async () => null),
      getConnectedServiceCredentialPlain: vi.fn(async () => null),
      registerConnectedServiceQuotaSnapshotPlain: vi.fn(async (params: RegisterPlainArgs) => {
        writtenRemaining.push(Number(params.content.v.meters[0]?.remainingPct ?? -1));
      }),
      getConnectedServiceQuotaSnapshotSealed: vi.fn(async () => null),
      getConnectedServiceCredentialSealed: vi.fn(async () => null),
      registerConnectedServiceQuotaSnapshotSealed: vi.fn(async () => {}),
    } as unknown as QuotaApi;
    const coordinator = new ConnectedServiceQuotasCoordinator({
      api,
      credentials,
      quotaFetchers: [],
      now: () => now,
      randomBytes: (length: number) => randomBytes(length),
      quotaPersistenceMinIntervalMs: 5_000,
    });

    const makeSnapshot = (remainingPct: number, fetchedAt: number): ConnectedServiceQuotaSnapshotV1 => ({
      v: 1,
      serviceId: 'openai-codex',
      profileId: 'work',
      fetchedAt,
      staleAfterMs: 300_000,
      planLabel: 'pro',
      accountLabel: null,
      meters: [{
        meterId: 'primary',
        label: 'Primary',
        used: null,
        limit: null,
        unit: 'unknown',
        utilizationPct: 100 - remainingPct,
        remainingPct,
        resetsAt: null,
        status: 'ok',
        details: {},
      }],
    });

    await expect(coordinator.recordInBandQuotaSnapshot({
      serviceId: 'openai-codex',
      profileId: 'work',
      snapshot: makeSnapshot(80, now),
    })).resolves.toEqual({ status: 'enqueued', enqueue: 'accepted' });
    await coordinator.flushInBandQuotaPersistence(1_000);

    now += 1_000;
    await expect(coordinator.recordInBandQuotaSnapshot({
      serviceId: 'openai-codex',
      profileId: 'work',
      snapshot: makeSnapshot(9, now),
    })).resolves.toEqual({ status: 'enqueued', enqueue: 'accepted' });
    now += 100;
    await expect(coordinator.recordInBandQuotaSnapshot({
      serviceId: 'openai-codex',
      profileId: 'work',
      snapshot: makeSnapshot(8, now),
    })).resolves.toEqual({ status: 'enqueued', enqueue: 'coalesced' });

    await coordinator.flushInBandQuotaPersistence(1_000);

    expect(writtenRemaining).toEqual([80, 8]);
  });

  it('resolves account encryption mode at in-band flush time', async () => {
    const now = 1_000_000;
    let connected = false;
    let accountMode: 'plain' | 'e2ee' = 'plain';
    const credentials: Credentials = {
      token: 'happy-token',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(9) },
    };
    const api = {
      getAccountEncryptionMode: vi.fn(async () => accountMode),
      getConnectedServiceQuotaSnapshotPlain: vi.fn(async () => null),
      getConnectedServiceCredentialPlain: vi.fn(async () => null),
      registerConnectedServiceQuotaSnapshotPlain: vi.fn(async () => {}),
      getConnectedServiceQuotaSnapshotSealed: vi.fn(async () => null),
      getConnectedServiceCredentialSealed: vi.fn(async () => null),
      registerConnectedServiceQuotaSnapshotSealed: vi.fn(async () => {}),
    } as unknown as QuotaApi;
    const coordinator = new ConnectedServiceQuotasCoordinator({
      api,
      credentials,
      quotaFetchers: [],
      now: () => now,
      randomBytes: (length: number) => randomBytes(length),
      quotaPersistenceIsConnected: () => connected,
    });

    await expect(coordinator.recordInBandQuotaSnapshot({
      serviceId: 'openai-codex',
      profileId: 'work',
      snapshot: {
        v: 1,
        serviceId: 'openai-codex',
        profileId: 'work',
        fetchedAt: now,
        staleAfterMs: 300_000,
        planLabel: 'pro',
        accountLabel: null,
        meters: [],
      },
    })).resolves.toEqual({ status: 'enqueued', enqueue: 'accepted' });
    expect(api.getAccountEncryptionMode).not.toHaveBeenCalled();

    accountMode = 'e2ee';
    connected = true;
    await coordinator.flushInBandQuotaPersistence(1_000);

    expect((api as any).registerConnectedServiceQuotaSnapshotPlain).not.toHaveBeenCalled();
    expect((api as any).registerConnectedServiceQuotaSnapshotSealed).toHaveBeenCalledTimes(1);
  });

  it('defers in-band quota persistence when account mode is unknown at flush time', async () => {
    const now = 1_000_000;
    const credentials: Credentials = {
      token: 'happy-token',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(9) },
    };
    const api = {
      getAccountEncryptionMode: vi.fn(async () => {
        throw new Error('mode unavailable');
      }),
      getConnectedServiceQuotaSnapshotPlain: vi.fn(async () => null),
      getConnectedServiceCredentialPlain: vi.fn(async () => null),
      registerConnectedServiceQuotaSnapshotPlain: vi.fn(async () => {}),
      getConnectedServiceQuotaSnapshotSealed: vi.fn(async () => null),
      getConnectedServiceCredentialSealed: vi.fn(async () => null),
      registerConnectedServiceQuotaSnapshotSealed: vi.fn(async () => {}),
    } as unknown as QuotaApi;
    const coordinator = new ConnectedServiceQuotasCoordinator({
      api,
      credentials,
      quotaFetchers: [],
      now: () => now,
      randomBytes: (length: number) => randomBytes(length),
      quotaPersistenceMinIntervalMs: 5_000,
    });

    await expect(coordinator.recordInBandQuotaSnapshot({
      serviceId: 'openai-codex',
      profileId: 'work',
      snapshot: {
        v: 1,
        serviceId: 'openai-codex',
        profileId: 'work',
        fetchedAt: now,
        staleAfterMs: 300_000,
        planLabel: 'pro',
        accountLabel: null,
        meters: [],
      },
    })).resolves.toEqual({ status: 'enqueued', enqueue: 'accepted' });

    await coordinator.flushInBandQuotaPersistence(25);

    expect((api as any).registerConnectedServiceQuotaSnapshotPlain).not.toHaveBeenCalled();
    expect((api as any).registerConnectedServiceQuotaSnapshotSealed).not.toHaveBeenCalled();
  });

  it('does not pause same-fingerprint in-band persistence after account mode recovers', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    let now = 1_000_000;
    let modeUnavailable = true;
    const credentials: Credentials = {
      token: 'happy-token',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(9) },
    };
    const api = {
      getAccountEncryptionMode: vi.fn(async () => {
        if (modeUnavailable) throw new Error('mode unavailable');
        return 'plain' as const;
      }),
      getConnectedServiceQuotaSnapshotPlain: vi.fn(async () => null),
      getConnectedServiceCredentialPlain: vi.fn(async () => null),
      registerConnectedServiceQuotaSnapshotPlain: vi.fn(async () => {}),
      getConnectedServiceQuotaSnapshotSealed: vi.fn(async () => null),
      getConnectedServiceCredentialSealed: vi.fn(async () => null),
      registerConnectedServiceQuotaSnapshotSealed: vi.fn(async () => {}),
    } as unknown as QuotaApi;
    const coordinator = new ConnectedServiceQuotasCoordinator({
      api,
      credentials,
      quotaFetchers: [],
      now: () => now,
      randomBytes: (length: number) => randomBytes(length),
      quotaPersistenceMinIntervalMs: 0,
      quotaPersistenceBackoffBaseMs: 10,
      quotaPersistenceBackoffMaxMs: 10,
      quotaPersistenceBackoffJitterRatio: 0,
      quotaPersistenceMaxConsecutiveFailures: 1,
    });
    const snapshot: ConnectedServiceQuotaSnapshotV1 = {
      v: 1,
      serviceId: 'openai-codex',
      profileId: 'work',
      fetchedAt: now,
      staleAfterMs: 300_000,
      planLabel: 'pro',
      accountLabel: null,
      meters: [],
    };

    await coordinator.recordInBandQuotaSnapshot({
      serviceId: 'openai-codex',
      profileId: 'work',
      snapshot,
    });
    const failedFlush = coordinator.flushInBandQuotaPersistence(1);
    await vi.advanceTimersByTimeAsync(1);
    await failedFlush;

    modeUnavailable = false;
    await coordinator.recordInBandQuotaSnapshot({
      serviceId: 'openai-codex',
      profileId: 'work',
      snapshot,
    });
    const recoveryFlush = coordinator.flushInBandQuotaPersistence(100);
    await vi.advanceTimersByTimeAsync(100);
    await recoveryFlush;

    expect((api as any).registerConnectedServiceQuotaSnapshotPlain).toHaveBeenCalledTimes(1);
  });

  it('does not resolve account mode when daemon server work gate defers persistence', async () => {
    const now = 1_000_000;
    const credentials: Credentials = {
      token: 'happy-token',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(9) },
    };
    const api = {
      getAccountEncryptionMode: vi.fn(async () => 'plain' as const),
      getConnectedServiceQuotaSnapshotPlain: vi.fn(async () => null),
      getConnectedServiceCredentialPlain: vi.fn(async () => null),
      registerConnectedServiceQuotaSnapshotPlain: vi.fn(async () => {}),
      getConnectedServiceQuotaSnapshotSealed: vi.fn(async () => null),
      getConnectedServiceCredentialSealed: vi.fn(async () => null),
      registerConnectedServiceQuotaSnapshotSealed: vi.fn(async () => {}),
    } as unknown as QuotaApi;
    const serverWorkScheduler = {
      enqueue: vi.fn(async () => ({ status: 'deferred' as const, reason: 'offline' })),
      flushAll: vi.fn(async () => ({ timedOut: false })),
      recordEvent: vi.fn(),
      getSnapshot: vi.fn(() => ({
        pendingKeyCount: 0,
        pendingPayloadBytes: 0,
        purposes: {},
        keys: {},
      })),
    } satisfies NonNullable<ConstructorParameters<typeof ConnectedServiceQuotasCoordinator>[0]['quotaPersistenceServerWorkScheduler']>;
    const coordinator = new ConnectedServiceQuotasCoordinator({
      api,
      credentials,
      quotaFetchers: [],
      now: () => now,
      randomBytes: (length: number) => randomBytes(length),
      quotaPersistenceServerWorkScheduler: serverWorkScheduler,
    });

    await expect(coordinator.recordInBandQuotaSnapshot({
      serviceId: 'openai-codex',
      profileId: 'work',
      snapshot: {
        v: 1,
        serviceId: 'openai-codex',
        profileId: 'work',
        fetchedAt: now,
        staleAfterMs: 300_000,
        planLabel: 'pro',
        accountLabel: null,
        meters: [],
      },
    })).resolves.toEqual({ status: 'enqueued', enqueue: 'accepted' });

    await coordinator.flushInBandQuotaPersistence(25);

    expect(serverWorkScheduler.enqueue).toHaveBeenCalled();
    expect(api.getAccountEncryptionMode).not.toHaveBeenCalled();
    expect((api as any).registerConnectedServiceQuotaSnapshotPlain).not.toHaveBeenCalled();
    expect((api as any).registerConnectedServiceQuotaSnapshotSealed).not.toHaveBeenCalled();
  });

  it('reports quota persistence flush timeout so pending server work can survive shutdown', async () => {
    const now = 1_000_000;
    const credentials: Credentials = {
      token: 'happy-token',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(9) },
    };
    const api = {
      getAccountEncryptionMode: vi.fn(async () => 'plain' as const),
      getConnectedServiceQuotaSnapshotPlain: vi.fn(async () => null),
      getConnectedServiceCredentialPlain: vi.fn(async () => null),
      registerConnectedServiceQuotaSnapshotPlain: vi.fn(async () => {}),
      getConnectedServiceQuotaSnapshotSealed: vi.fn(async () => null),
      getConnectedServiceCredentialSealed: vi.fn(async () => null),
      registerConnectedServiceQuotaSnapshotSealed: vi.fn(async () => {}),
    } as unknown as QuotaApi;
    const serverWorkScheduler = {
      enqueue: vi.fn(async () => ({ status: 'deferred' as const, reason: 'offline' })),
      flushAll: vi.fn(async () => ({ timedOut: true })),
      recordEvent: vi.fn(),
      getSnapshot: vi.fn(() => ({
        pendingKeyCount: 1,
        pendingPayloadBytes: 128,
        purposes: {
          connectedServiceQuotaPersistence: {
            counters: {
              accepted: 1,
              coalesced: 0,
              suppressed: 0,
              written: 0,
              failed: 0,
              deferred: 1,
              retried: 0,
            },
          },
        },
        keys: {},
      })),
    } satisfies NonNullable<ConstructorParameters<typeof ConnectedServiceQuotasCoordinator>[0]['quotaPersistenceServerWorkScheduler']>;
    const coordinator = new ConnectedServiceQuotasCoordinator({
      api,
      credentials,
      quotaFetchers: [],
      now: () => now,
      randomBytes: (length: number) => randomBytes(length),
      quotaPersistenceServerWorkScheduler: serverWorkScheduler,
    });

    await coordinator.recordInBandQuotaSnapshot({
      serviceId: 'openai-codex',
      profileId: 'work',
      snapshot: {
        v: 1,
        serviceId: 'openai-codex',
        profileId: 'work',
        fetchedAt: now,
        staleAfterMs: 300_000,
        planLabel: 'pro',
        accountLabel: null,
        meters: [],
      },
    });

    await expect(coordinator.flushInBandQuotaPersistence(25)).resolves.toEqual({
      timedOut: true,
      inProcess: { timedOut: true, drained: false },
      serverWork: { timedOut: true },
    });
    expect(serverWorkScheduler.getSnapshot().pendingKeyCount).toBe(1);
  });

  it('combines in-process quota persistence timeout state with server-work flush state', async () => {
    vi.useFakeTimers();
    const now = 1_000_000;
    const accountMode = createDeferred<'plain'>();
    const credentials: Credentials = {
      token: 'happy-token',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(9) },
    };
    const api = {
      getAccountEncryptionMode: vi.fn(async () => await accountMode.promise),
      getConnectedServiceQuotaSnapshotPlain: vi.fn(async () => null),
      getConnectedServiceCredentialPlain: vi.fn(async () => null),
      registerConnectedServiceQuotaSnapshotPlain: vi.fn(async () => {}),
      getConnectedServiceQuotaSnapshotSealed: vi.fn(async () => null),
      getConnectedServiceCredentialSealed: vi.fn(async () => null),
      registerConnectedServiceQuotaSnapshotSealed: vi.fn(async () => {}),
    } as unknown as QuotaApi;
    const coordinator = new ConnectedServiceQuotasCoordinator({
      api,
      credentials,
      quotaFetchers: [],
      now: () => now,
      randomBytes: (length: number) => randomBytes(length),
      quotaPersistenceMinIntervalMs: 0,
    });

    await coordinator.recordInBandQuotaSnapshot({
      serviceId: 'openai-codex',
      profileId: 'work',
      snapshot: {
        v: 1,
        serviceId: 'openai-codex',
        profileId: 'work',
        fetchedAt: now,
        staleAfterMs: 300_000,
        planLabel: 'pro',
        accountLabel: null,
        meters: [],
      },
    });

    const flushed = coordinator.flushInBandQuotaPersistence(25);
    await vi.advanceTimersByTimeAsync(25);

    await expect(flushed).resolves.toEqual({
      timedOut: true,
      inProcess: { timedOut: true, drained: false },
      serverWork: null,
    });
  });

  it('uses daemon server-work Retry-After outcomes as quota persistence backoff', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const now = 1_000_000;
    const credentials: Credentials = {
      token: 'happy-token',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(9) },
    };
    const api = {
      getAccountEncryptionMode: vi.fn(async () => 'plain' as const),
      getConnectedServiceQuotaSnapshotPlain: vi.fn(async () => null),
      getConnectedServiceCredentialPlain: vi.fn(async () => null),
      registerConnectedServiceQuotaSnapshotPlain: vi.fn(async () => {}),
      getConnectedServiceQuotaSnapshotSealed: vi.fn(async () => null),
      getConnectedServiceCredentialSealed: vi.fn(async () => null),
      registerConnectedServiceQuotaSnapshotSealed: vi.fn(async () => {}),
    } as unknown as QuotaApi;
    const serverWorkScheduler = {
      enqueue: vi.fn(async (request) => {
        if (serverWorkScheduler.enqueue.mock.calls.length === 1) {
          return {
            status: 'failed' as const,
            classification: {
              kind: 'rate_limited' as const,
              retryable: true,
              statusCode: 429,
              retryAfterMs: 5_000,
            },
          };
        }
        await request.run(request.payload);
        return { status: 'written' as const };
      }),
      flushAll: vi.fn(async () => ({ timedOut: false })),
      recordEvent: vi.fn(),
      getSnapshot: vi.fn(() => ({
        pendingKeyCount: 0,
        pendingPayloadBytes: 0,
        purposes: {},
        keys: {},
      })),
    } satisfies NonNullable<ConstructorParameters<typeof ConnectedServiceQuotasCoordinator>[0]['quotaPersistenceServerWorkScheduler']>;
    const coordinator = new ConnectedServiceQuotasCoordinator({
      api,
      credentials,
      quotaFetchers: [],
      now: () => now,
      randomBytes: (length: number) => randomBytes(length),
      quotaPersistenceServerWorkScheduler: serverWorkScheduler,
      quotaPersistenceMinIntervalMs: 0,
      quotaPersistenceBackoffBaseMs: 100,
      quotaPersistenceBackoffMaxMs: 100,
      quotaPersistenceBackoffJitterRatio: 0,
      quotaPersistenceMaxConsecutiveFailures: 10,
    });

    await coordinator.recordInBandQuotaSnapshot({
      serviceId: 'openai-codex',
      profileId: 'work',
      snapshot: {
        v: 1,
        serviceId: 'openai-codex',
        profileId: 'work',
        fetchedAt: now,
        staleAfterMs: 300_000,
        planLabel: 'pro',
        accountLabel: null,
        meters: [],
      },
    });
    const initialFlush = coordinator.flushInBandQuotaPersistence(20);
    await vi.advanceTimersByTimeAsync(20);
    await initialFlush;

    expect(serverWorkScheduler.enqueue).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(4_979);
    expect(serverWorkScheduler.enqueue).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(serverWorkScheduler.enqueue).toHaveBeenCalledTimes(2);
    expect((api as any).registerConnectedServiceQuotaSnapshotPlain).toHaveBeenCalledTimes(1);
  });

  it('does not mirror server-work owned write attempt counters from the latest-work scheduler', async () => {
    const now = 1_000_000;
    const credentials: Credentials = {
      token: 'happy-token',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(9) },
    };
    const api = {
      getAccountEncryptionMode: vi.fn(async () => 'plain' as const),
      getConnectedServiceQuotaSnapshotPlain: vi.fn(async () => null),
      getConnectedServiceCredentialPlain: vi.fn(async () => null),
      registerConnectedServiceQuotaSnapshotPlain: vi.fn(async () => {}),
      getConnectedServiceQuotaSnapshotSealed: vi.fn(async () => null),
      getConnectedServiceCredentialSealed: vi.fn(async () => null),
      registerConnectedServiceQuotaSnapshotSealed: vi.fn(async () => {}),
    } as unknown as QuotaApi;
    const serverWorkScheduler = {
      enqueue: vi.fn(async (request) => {
        await request.run(request.payload);
        return { status: 'written' as const };
      }),
      flushAll: vi.fn(async () => ({ timedOut: false })),
      recordEvent: vi.fn(),
      getSnapshot: vi.fn(() => ({
        pendingKeyCount: 0,
        pendingPayloadBytes: 0,
        purposes: {},
        keys: {},
      })),
    } satisfies NonNullable<ConstructorParameters<typeof ConnectedServiceQuotasCoordinator>[0]['quotaPersistenceServerWorkScheduler']>;
    const coordinator = new ConnectedServiceQuotasCoordinator({
      api,
      credentials,
      quotaFetchers: [],
      now: () => now,
      randomBytes: (length: number) => randomBytes(length),
      quotaPersistenceServerWorkScheduler: serverWorkScheduler,
    });

    await coordinator.recordInBandQuotaSnapshot({
      serviceId: 'openai-codex',
      profileId: 'work',
      snapshot: {
        v: 1,
        serviceId: 'openai-codex',
        profileId: 'work',
        fetchedAt: now,
        staleAfterMs: 300_000,
        planLabel: 'pro',
        accountLabel: null,
        meters: [],
      },
    });
    await coordinator.flushInBandQuotaPersistence(1_000);

    expect(serverWorkScheduler.recordEvent).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'accepted' }));
    expect(serverWorkScheduler.recordEvent).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'written' }));
    expect(serverWorkScheduler.recordEvent).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'failed' }));
    expect(serverWorkScheduler.recordEvent).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'retried' }));
  });
});
