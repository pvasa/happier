import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_CONNECTED_SERVICE_AUTH_GROUP_POLICY_V1 } from '../accountGroups/selection/selectConnectedServiceAuthGroupCandidate';
import {
  ConnectedServiceAuthGroupSwitchCoordinator,
  InMemoryConnectedServiceAuthGroupSwitchLeaseRegistry,
} from '../accountGroups/switching/ConnectedServiceAuthGroupSwitchCoordinator';
import { buildConnectedServiceCredentialRecord } from '@happier-dev/protocol';
import { handleConnectedServiceRuntimeAuthFailureForSession } from './handleConnectedServiceRuntimeAuthFailureForSession';
import { ConnectedServiceRuntimeAuthSwitchAttemptTracker } from './ConnectedServiceRuntimeAuthSwitchAttemptTracker';
import type {
  ConnectedServiceSessionAuthSwitchCore,
  ConnectedServiceSessionAuthSwitchReason,
} from './connectedServiceSessionAuthSwitchCore';
import type { ConnectedServiceRuntimeFailureClassification } from './types';

function createTemporaryThrottleClassification(
  overrides?: Partial<ConnectedServiceRuntimeFailureClassification>,
): ConnectedServiceRuntimeFailureClassification {
  return {
    // The runtime-auth wire contract is being extended to carry this explicit recovery kind.
    kind: 'temporary_throttle' as ConnectedServiceRuntimeFailureClassification['kind'],
    limitCategory: 'rate_limit',
    serviceId: 'openai-codex',
    profileId: 'primary',
    groupId: 'main',
    resetsAtMs: null,
    retryAfterMs: 45_000,
    planType: null,
    rateLimits: null,
    source: 'structured_provider_error',
    ...overrides,
  };
}

describe('handleConnectedServiceRuntimeAuthFailureForSession', () => {
  it('emits a session transcript event when runtime recovery switches a group account', async () => {
    const emitSessionEvent = vi.fn();
    const switchAfterClassifiedFailure = vi.fn(async () => ({
      status: 'switched' as const,
      activeProfileId: 'backup',
      generation: 2,
      mode: 'hot_apply' as const,
    }));

    await expect(handleConnectedServiceRuntimeAuthFailureForSession({
      getChildren: () => [{
        startedBy: 'daemon',
        happySessionId: 'sess_1',
        pid: 123,
        spawnOptions: {
          directory: '/tmp/project',
          connectedServices: {
            v: 1,
            bindingsByServiceId: {
              'openai-codex': {
                source: 'connected',
                selection: 'group',
                profileId: 'primary',
                groupId: 'main',
              },
            },
          },
        },
      }],
      switchCoordinator: { switchAfterClassifiedFailure },
      emitSessionEvent,
      sessionId: 'sess_1',
      switchesThisTurn: 0,
      classification: {
        kind: 'usage_limit',
        serviceId: 'openai-codex',
        profileId: 'primary',
        groupId: 'main',
        resetsAtMs: null,
        retryAfterMs: null,
        planType: null,
        rateLimits: null,
        source: 'structured_provider_error',
      },
    })).resolves.toMatchObject({
      status: 'switch_attempted',
      result: { status: 'switched', activeProfileId: 'backup', generation: 2 },
    });

    expect(emitSessionEvent).toHaveBeenCalledWith('sess_1', expect.objectContaining({
      type: 'connected_service_auth_group_switch',
      serviceId: 'openai-codex',
      groupId: 'main',
      fromProfileId: 'primary',
      toProfileId: 'backup',
      reason: 'usage_limit',
      mode: 'hot_apply',
      toGeneration: 2,
      resultStatus: 'switched',
      success: true,
    }));
  });

  it('requests a session restart when runtime recovery switches a group account for the next turn', async () => {
    const restartSession = vi.fn(async () => {});
    const switchAfterClassifiedFailure = vi.fn(async () => ({
      status: 'switched' as const,
      activeProfileId: 'backup',
      generation: 2,
      mode: 'spawn_next_turn' as const,
    }));

    await expect(handleConnectedServiceRuntimeAuthFailureForSession({
      getChildren: () => [{
        startedBy: 'daemon',
        happySessionId: 'sess_1',
        pid: 123,
        spawnOptions: {
          directory: '/tmp/project',
          connectedServices: {
            v: 1,
            bindingsByServiceId: {
              'openai-codex': {
                source: 'connected',
                selection: 'group',
                profileId: 'primary',
                groupId: 'main',
              },
            },
          },
        },
      }],
      switchCoordinator: { switchAfterClassifiedFailure },
      restartSession,
      sessionId: 'sess_1',
      switchesThisTurn: 0,
      classification: {
        kind: 'usage_limit',
        serviceId: 'openai-codex',
        profileId: 'primary',
        groupId: 'main',
        resetsAtMs: null,
        retryAfterMs: null,
        planType: null,
        rateLimits: null,
        source: 'structured_provider_error',
      },
    })).resolves.toMatchObject({
      status: 'switch_attempted',
      result: {
        status: 'switched',
        activeProfileId: 'backup',
        generation: 2,
        mode: 'spawn_next_turn',
      },
    });

    expect(restartSession).toHaveBeenCalledOnce();
    expect(restartSession).toHaveBeenCalledWith(expect.objectContaining({
      happySessionId: 'sess_1',
      pid: 123,
    }));
  });

  it('force-refreshes the active group profile before switching on runtime credential failure', async () => {
    const refreshConnectedServiceCredentialForRuntimeAuthFailure = vi.fn(async () => ({
      status: 'refreshed' as const,
      credential: buildConnectedServiceCredentialRecord({
        now: 1,
        serviceId: 'openai-codex',
        profileId: 'primary',
        kind: 'oauth',
        expiresAt: 3_600_000,
        oauth: {
          accessToken: 'fresh-access',
          refreshToken: 'refresh',
          idToken: null,
          scope: null,
          tokenType: null,
          providerAccountId: 'acct',
          providerEmail: null,
        },
      }),
      diagnostic: {
        serviceId: 'openai-codex' as const,
        profileId: 'primary',
        reason: 'runtime_auth_failure' as const,
        status: 'refreshed' as const,
        expiresAt: 3_600_000,
        expiryAgeMs: -3_599_000,
        refreshWindowMs: 60_000,
      },
    }));
    const restartSession = vi.fn(async () => {});
    const switchAfterClassifiedFailure = vi.fn(async () => ({
      status: 'switched' as const,
      activeProfileId: 'backup',
      generation: 2,
    }));

    await expect(handleConnectedServiceRuntimeAuthFailureForSession({
      getChildren: () => [{
        startedBy: 'daemon',
        happySessionId: 'sess_1',
        pid: 123,
        spawnOptions: {
          directory: '/tmp/project',
          connectedServices: {
            v: 1,
            bindingsByServiceId: {
              'openai-codex': {
                source: 'connected',
                selection: 'group',
                profileId: 'primary',
                groupId: 'main',
              },
            },
          },
        },
      }],
      switchCoordinator: { switchAfterClassifiedFailure },
      credentialRefreshService: {
        refreshConnectedServiceCredentialForRuntimeAuthFailure,
      },
      restartSession,
      sessionId: 'sess_1',
      switchesThisTurn: 0,
      classification: {
        kind: 'auth_expired',
        limitCategory: 'auth',
        serviceId: 'openai-codex',
        profileId: 'primary',
        groupId: 'main',
        resetsAtMs: null,
        planType: null,
        rateLimits: null,
        source: 'structured_provider_error',
      },
    })).resolves.toMatchObject({
      status: 'credential_refreshed',
      restartRequested: true,
    });

    expect(refreshConnectedServiceCredentialForRuntimeAuthFailure).toHaveBeenCalledWith({
      serviceId: 'openai-codex',
      profileId: 'primary',
    });
    expect(restartSession).toHaveBeenCalledWith(expect.objectContaining({
      happySessionId: 'sess_1',
      pid: 123,
    }));
    expect(switchAfterClassifiedFailure).not.toHaveBeenCalled();
  });

  it('serializes runtime forced refresh through the session auth-switch core', async () => {
    const events: string[] = [];
    const coreRuns: Array<Readonly<{ sessionId: string; reason: string }>> = [];
    const switchCore: ConnectedServiceSessionAuthSwitchCore = {
      async run<T>(params: Readonly<{
        sessionId: string;
        reason: ConnectedServiceSessionAuthSwitchReason;
        execute: () => Promise<T>;
      }>): Promise<T> {
        coreRuns.push({ sessionId: params.sessionId, reason: params.reason });
        events.push('core:start');
        const result = await params.execute();
        events.push('core:end');
        return result;
      },
      clearSession: vi.fn(),
    };
    const refreshConnectedServiceCredentialForRuntimeAuthFailure = vi.fn(async () => {
      events.push('refresh');
      expect(events).toEqual(['core:start', 'refresh']);
      return {
        status: 'refreshed' as const,
        credential: buildConnectedServiceCredentialRecord({
          now: 1,
          serviceId: 'openai-codex',
          profileId: 'primary',
          kind: 'oauth',
          expiresAt: 3_600_000,
          oauth: {
            accessToken: 'fresh-access',
            refreshToken: 'refresh',
            idToken: null,
            scope: null,
            tokenType: null,
            providerAccountId: 'acct',
            providerEmail: null,
          },
        }),
        diagnostic: {
          serviceId: 'openai-codex' as const,
          profileId: 'primary',
          reason: 'runtime_auth_failure' as const,
          status: 'refreshed' as const,
          expiresAt: 3_600_000,
          expiryAgeMs: -3_599_000,
          refreshWindowMs: 60_000,
        },
      };
    });
    const restartSession = vi.fn(async () => {
      events.push('restart');
    });

    await expect(handleConnectedServiceRuntimeAuthFailureForSession({
      getChildren: () => [{
        startedBy: 'daemon',
        happySessionId: 'sess_1',
        pid: 123,
        spawnOptions: {
          directory: '/tmp/project',
          connectedServices: {
            v: 1,
            bindingsByServiceId: {
              'openai-codex': {
                source: 'connected',
                selection: 'group',
                profileId: 'primary',
                groupId: 'main',
              },
            },
          },
        },
      }],
      switchCoordinator: { switchAfterClassifiedFailure: vi.fn() },
      switchCore,
      credentialRefreshService: {
        refreshConnectedServiceCredentialForRuntimeAuthFailure,
      },
      restartSession,
      sessionId: 'sess_1',
      switchesThisTurn: 0,
      classification: {
        kind: 'auth_expired',
        limitCategory: 'auth',
        serviceId: 'openai-codex',
        profileId: 'primary',
        groupId: 'main',
        resetsAtMs: null,
        planType: null,
        rateLimits: null,
        source: 'structured_provider_error',
      },
    })).resolves.toMatchObject({
      status: 'credential_refreshed',
      restartRequested: true,
    });

    expect(coreRuns).toEqual([{
      sessionId: 'sess_1',
      reason: 'automatic_runtime_failure',
    }]);
    expect(events).toEqual(['core:start', 'refresh', 'restart', 'core:end']);
  });

  it('does not force-refresh the same active profile twice in the failure window', async () => {
    const switchAttemptTracker = new ConnectedServiceRuntimeAuthSwitchAttemptTracker({
      nowMs: () => 1_000,
      windowMs: 60_000,
    });
    const refreshConnectedServiceCredentialForRuntimeAuthFailure = vi.fn(async () => ({
      status: 'refresh_failed' as const,
      credential: null,
      diagnostic: {
        serviceId: 'openai-codex' as const,
        profileId: 'primary',
        reason: 'runtime_auth_failure' as const,
        status: 'refresh_failed' as const,
        category: 'invalid_grant' as const,
        expiresAt: 999,
        expiryAgeMs: 1,
        refreshWindowMs: 60_000,
      },
    }));
    const switchAfterClassifiedFailure = vi.fn(async () => ({
      status: 'no_eligible_member' as const,
      generation: 1,
      groupExhausted: true as const,
      retryAtMs: null,
      excluded: [],
    }));
    const trackedSession = {
      startedBy: 'daemon' as const,
      happySessionId: 'sess_1',
      pid: 123,
      spawnOptions: {
        directory: '/tmp/project',
        connectedServices: {
          v: 1 as const,
          bindingsByServiceId: {
            'openai-codex': {
              source: 'connected' as const,
              selection: 'group' as const,
              profileId: 'primary',
              groupId: 'main',
            },
          },
        },
      },
    };
    const classification = {
      kind: 'auth_expired' as const,
      limitCategory: 'auth' as const,
      serviceId: 'openai-codex',
      profileId: 'primary',
      groupId: 'main',
      resetsAtMs: null,
      planType: null,
      rateLimits: null,
      source: 'structured_provider_error' as const,
    };

    await handleConnectedServiceRuntimeAuthFailureForSession({
      getChildren: () => [trackedSession],
      switchCoordinator: { switchAfterClassifiedFailure },
      switchAttemptTracker,
      credentialRefreshService: {
        refreshConnectedServiceCredentialForRuntimeAuthFailure,
      },
      sessionId: 'sess_1',
      switchesThisTurn: 0,
      classification,
    });
    await handleConnectedServiceRuntimeAuthFailureForSession({
      getChildren: () => [trackedSession],
      switchCoordinator: { switchAfterClassifiedFailure },
      switchAttemptTracker,
      credentialRefreshService: {
        refreshConnectedServiceCredentialForRuntimeAuthFailure,
      },
      sessionId: 'sess_1',
      switchesThisTurn: 0,
      classification,
    });

    expect(refreshConnectedServiceCredentialForRuntimeAuthFailure).toHaveBeenCalledTimes(1);
    expect(switchAfterClassifiedFailure).toHaveBeenCalledTimes(2);
  });

  it('routes tracked group session failures into the switch coordinator with the tracked group id', async () => {
    const switchAfterClassifiedFailure = vi.fn(async () => ({
      status: 'switched' as const,
      activeProfileId: 'backup',
      generation: 2,
    }));
    const emitSessionEvent = vi.fn();

    await expect(handleConnectedServiceRuntimeAuthFailureForSession({
      getChildren: () => [{
        startedBy: 'daemon',
        happySessionId: 'sess_1',
        pid: 123,
        spawnOptions: {
          directory: '/tmp/project',
          connectedServices: {
            v: 1,
            bindingsByServiceId: {
              'openai-codex': {
                source: 'connected',
                selection: 'group',
                profileId: 'primary',
                groupId: 'main',
              },
            },
          },
        },
      }],
      switchCoordinator: { switchAfterClassifiedFailure },
      emitSessionEvent,
      sessionId: 'sess_1',
      switchesThisTurn: 0,
      classification: {
        kind: 'usage_limit',
        limitCategory: 'quota',
        serviceId: 'openai-codex',
        profileId: null,
        groupId: null,
        resetsAtMs: null,
        retryAfterMs: 30_000,
        quotaScope: 'account',
        providerLimitId: 'weekly',
        action: { kind: 'open_url', url: 'https://chatgpt.com/codex/settings/usage' },
        planType: null,
        rateLimits: null,
        source: 'structured_provider_error',
      },
    })).resolves.toEqual({
      status: 'switch_attempted',
      result: {
        status: 'switched',
        activeProfileId: 'backup',
        generation: 2,
      },
    });

    expect(switchAfterClassifiedFailure).toHaveBeenCalledWith({
      sessionId: 'sess_1',
      serviceId: 'openai-codex',
      groupId: 'main',
      reason: 'usage_limit',
      observedProfileId: 'primary',
      retryAfterMs: 30_000,
      resetsAtMs: null,
      limitCategory: 'quota',
      quotaScope: 'account',
      providerLimitId: 'weekly',
      action: { kind: 'open_url', url: 'https://chatgpt.com/codex/settings/usage' },
      planType: null,
      switchesThisTurn: 0,
    });
    expect(emitSessionEvent).toHaveBeenCalledWith('sess_1', expect.objectContaining({
      type: 'connected_service_auth_group_switch',
      serviceId: 'openai-codex',
      groupId: 'main',
      fromProfileId: 'primary',
      toProfileId: 'backup',
      reason: 'usage_limit',
      toGeneration: 2,
      resultStatus: 'switched',
      success: true,
    }));
  });

  it('arms temporary-throttle recovery without falling through to group switching', async () => {
    const switchAfterClassifiedFailure = vi.fn(async () => ({
      status: 'switched' as const,
      activeProfileId: 'backup',
      generation: 2,
    }));
    const enable = vi.fn(async () => ({
      status: 'waiting' as const,
      nextRetryAtMs: 46_000,
      attemptCount: 0,
    }));
    const input = {
      getChildren: () => [{
        startedBy: 'daemon' as const,
        happySessionId: 'sess_1',
        pid: 123,
        spawnOptions: {
          directory: '/tmp/project',
          connectedServices: {
            v: 1 as const,
            bindingsByServiceId: {
              'openai-codex': {
                source: 'connected' as const,
                selection: 'group' as const,
                profileId: 'primary',
                groupId: 'main',
              },
            },
          },
        },
      }],
      switchCoordinator: { switchAfterClassifiedFailure },
      temporaryThrottleRecovery: { enable },
      sessionId: 'sess_1',
      switchesThisTurn: 0,
      classification: createTemporaryThrottleClassification(),
    };

    await expect(handleConnectedServiceRuntimeAuthFailureForSession(input)).resolves.toEqual({
      status: 'temporary_retry_armed',
      serviceId: 'openai-codex',
      profileId: 'primary',
      groupId: 'main',
      retryAfterMs: 45_000,
      recovery: {
        status: 'waiting',
        nextRetryAtMs: 46_000,
        attemptCount: 0,
      },
    });

    expect(enable).toHaveBeenCalledWith({
      sessionId: 'sess_1',
      issueFingerprint: 'temporary-throttle:openai-codex:main:primary',
      retryAfterMs: 45_000,
    });
    expect(switchAfterClassifiedFailure).not.toHaveBeenCalled();
  });

  it('prefers the canonical active group profile from session environment during runtime recovery', async () => {
    const switchAfterClassifiedFailure = vi.fn(async () => ({
      status: 'switched' as const,
      activeProfileId: 'tertiary',
      generation: 3,
    }));
    const emitSessionEvent = vi.fn();

    await expect(handleConnectedServiceRuntimeAuthFailureForSession({
      getChildren: () => [{
        startedBy: 'daemon',
        happySessionId: 'sess_1',
        pid: 123,
        spawnOptions: {
          directory: '/tmp/project',
          connectedServices: {
            v: 1,
            bindingsByServiceId: {
              'openai-codex': {
                source: 'connected',
                selection: 'group',
                profileId: 'primary',
                groupId: 'main',
              },
            },
          },
          environmentVariables: {
            HAPPIER_CONNECTED_SERVICE_SELECTIONS_JSON: JSON.stringify([{
              kind: 'group',
              serviceId: 'openai-codex',
              groupId: 'main',
              activeProfileId: 'backup',
              fallbackProfileId: 'primary',
              generation: 2,
            }]),
          },
        },
      }],
      switchCoordinator: { switchAfterClassifiedFailure },
      emitSessionEvent,
      sessionId: 'sess_1',
      switchesThisTurn: 0,
      classification: {
        kind: 'usage_limit',
        limitCategory: 'quota',
        serviceId: 'openai-codex',
        profileId: null,
        groupId: null,
        resetsAtMs: null,
        retryAfterMs: 30_000,
        quotaScope: 'account',
        providerLimitId: 'weekly',
        action: null,
        planType: null,
        rateLimits: null,
        source: 'structured_provider_error',
      },
    })).resolves.toEqual({
      status: 'switch_attempted',
      result: {
        status: 'switched',
        activeProfileId: 'tertiary',
        generation: 3,
      },
    });

    expect(switchAfterClassifiedFailure).toHaveBeenCalledWith(expect.objectContaining({
      observedProfileId: 'backup',
    }));
    expect(emitSessionEvent).toHaveBeenCalledWith('sess_1', expect.objectContaining({
      type: 'connected_service_auth_group_switch',
      serviceId: 'openai-codex',
      groupId: 'main',
      fromProfileId: 'backup',
      toProfileId: 'tertiary',
      reason: 'usage_limit',
      toGeneration: 3,
      resultStatus: 'switched',
      success: true,
    }));
  });

  it('force-refreshes a classified group profile when tracked spawn options lost connected services', async () => {
    const refreshConnectedServiceCredentialForRuntimeAuthFailure = vi.fn(async () => ({
      status: 'refreshed' as const,
      credential: buildConnectedServiceCredentialRecord({
        now: 1,
        serviceId: 'openai-codex',
        profileId: 'primary',
        kind: 'oauth',
        expiresAt: 3_600_000,
        oauth: {
          accessToken: 'fresh-access',
          refreshToken: 'refresh',
          idToken: null,
          scope: null,
          tokenType: null,
          providerAccountId: 'acct',
          providerEmail: null,
        },
      }),
      diagnostic: {
        serviceId: 'openai-codex' as const,
        profileId: 'primary',
        reason: 'runtime_auth_failure' as const,
        status: 'refreshed' as const,
        expiresAt: 3_600_000,
        expiryAgeMs: -3_599_000,
        refreshWindowMs: 60_000,
      },
    }));
    const restartSession = vi.fn(async () => {});
    const switchAfterClassifiedFailure = vi.fn();

    await expect(handleConnectedServiceRuntimeAuthFailureForSession({
      getChildren: () => [{
        startedBy: 'daemon',
        happySessionId: 'sess_1',
        pid: 123,
        spawnOptions: {
          directory: '/tmp/project',
        },
      }],
      switchCoordinator: { switchAfterClassifiedFailure },
      credentialRefreshService: {
        refreshConnectedServiceCredentialForRuntimeAuthFailure,
      },
      restartSession,
      sessionId: 'sess_1',
      switchesThisTurn: 0,
      classification: {
        kind: 'auth_expired',
        limitCategory: 'auth',
        serviceId: 'openai-codex',
        profileId: 'primary',
        groupId: 'main',
        resetsAtMs: null,
        planType: null,
        rateLimits: null,
        source: 'structured_provider_error',
      },
    })).resolves.toMatchObject({
      status: 'credential_refreshed',
      restartRequested: true,
    });

    expect(refreshConnectedServiceCredentialForRuntimeAuthFailure).toHaveBeenCalledWith({
      serviceId: 'openai-codex',
      profileId: 'primary',
    });
    expect(restartSession).toHaveBeenCalledWith(expect.objectContaining({
      happySessionId: 'sess_1',
      pid: 123,
    }));
    expect(switchAfterClassifiedFailure).not.toHaveBeenCalled();
  });

  it('switches a classified group after permanent refresh failure when tracked spawn options lost connected services', async () => {
    const refreshConnectedServiceCredentialForRuntimeAuthFailure = vi.fn(async () => ({
      status: 'refresh_failed' as const,
      credential: null,
      diagnostic: {
        serviceId: 'openai-codex' as const,
        profileId: 'primary',
        reason: 'runtime_auth_failure' as const,
        status: 'refresh_failed' as const,
        category: 'provider_401' as const,
        expiresAt: 999,
        expiryAgeMs: 1,
        refreshWindowMs: 60_000,
      },
    }));
    const switchAfterClassifiedFailure = vi.fn(async () => ({
      status: 'switched' as const,
      activeProfileId: 'backup',
      generation: 2,
    }));

    await expect(handleConnectedServiceRuntimeAuthFailureForSession({
      getChildren: () => [{
        startedBy: 'daemon',
        happySessionId: 'sess_1',
        pid: 123,
        spawnOptions: {
          directory: '/tmp/project',
        },
      }],
      switchCoordinator: { switchAfterClassifiedFailure },
      credentialRefreshService: {
        refreshConnectedServiceCredentialForRuntimeAuthFailure,
      },
      sessionId: 'sess_1',
      switchesThisTurn: 0,
      classification: {
        kind: 'refresh_failed',
        limitCategory: 'auth',
        serviceId: 'openai-codex',
        profileId: 'primary',
        groupId: 'main',
        resetsAtMs: null,
        planType: null,
        rateLimits: null,
        source: 'structured_provider_error',
      },
    })).resolves.toEqual({
      status: 'switch_attempted',
      result: {
        status: 'switched',
        activeProfileId: 'backup',
        generation: 2,
      },
    });

    expect(refreshConnectedServiceCredentialForRuntimeAuthFailure).toHaveBeenCalledWith({
      serviceId: 'openai-codex',
      profileId: 'primary',
    });
    expect(switchAfterClassifiedFailure).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'sess_1',
      serviceId: 'openai-codex',
      groupId: 'main',
      reason: 'refresh_failed',
      observedProfileId: 'primary',
    }));
  });

  it('surfaces reconnect for a classified profile after permanent refresh failure when tracked spawn options lost connected services', async () => {
    const refreshConnectedServiceCredentialForRuntimeAuthFailure = vi.fn(async () => ({
      status: 'refresh_failed' as const,
      credential: null,
      diagnostic: {
        serviceId: 'openai-codex' as const,
        profileId: 'primary',
        reason: 'runtime_auth_failure' as const,
        status: 'refresh_failed' as const,
        category: 'invalid_grant' as const,
        expiresAt: 999,
        expiryAgeMs: 1,
        refreshWindowMs: 60_000,
      },
    }));
    const switchAfterClassifiedFailure = vi.fn();

    await expect(handleConnectedServiceRuntimeAuthFailureForSession({
      getChildren: () => [{
        startedBy: 'daemon',
        happySessionId: 'sess_1',
        pid: 123,
        spawnOptions: {
          directory: '/tmp/project',
        },
      }],
      switchCoordinator: { switchAfterClassifiedFailure },
      credentialRefreshService: {
        refreshConnectedServiceCredentialForRuntimeAuthFailure,
      },
      sessionId: 'sess_1',
      switchesThisTurn: 0,
      classification: {
        kind: 'refresh_failed',
        limitCategory: 'auth',
        serviceId: 'openai-codex',
        profileId: 'primary',
        groupId: null,
        resetsAtMs: null,
        planType: null,
        rateLimits: null,
        source: 'structured_provider_error',
      },
    })).resolves.toEqual({
      status: 'recovery_action_required',
      action: {
        kind: 'reconnect_profile',
        serviceId: 'openai-codex',
        profileId: 'primary',
        groupId: null,
        reason: 'refresh_failed',
      },
    });

    expect(refreshConnectedServiceCredentialForRuntimeAuthFailure).toHaveBeenCalledWith({
      serviceId: 'openai-codex',
      profileId: 'primary',
    });
    expect(switchAfterClassifiedFailure).not.toHaveBeenCalled();
  });

  it('does not synthesize connected-service recovery without a classified profile id', async () => {
    const refreshConnectedServiceCredentialForRuntimeAuthFailure = vi.fn();
    const switchAfterClassifiedFailure = vi.fn();

    await expect(handleConnectedServiceRuntimeAuthFailureForSession({
      getChildren: () => [{
        startedBy: 'daemon',
        happySessionId: 'sess_1',
        pid: 123,
        spawnOptions: {
          directory: '/tmp/project',
        },
      }],
      switchCoordinator: { switchAfterClassifiedFailure },
      credentialRefreshService: {
        refreshConnectedServiceCredentialForRuntimeAuthFailure,
      },
      sessionId: 'sess_1',
      switchesThisTurn: 0,
      classification: {
        kind: 'auth_expired',
        limitCategory: 'auth',
        serviceId: 'openai-codex',
        profileId: null,
        groupId: 'main',
        resetsAtMs: null,
        planType: null,
        rateLimits: null,
        source: 'structured_provider_error',
      },
    })).resolves.toEqual({
      status: 'recovery_action_required',
      action: {
        kind: 'connected_service_required',
        serviceId: 'openai-codex',
        profileId: null,
        groupId: 'main',
        reason: 'auth_expired',
      },
    });

    expect(refreshConnectedServiceCredentialForRuntimeAuthFailure).not.toHaveBeenCalled();
    expect(switchAfterClassifiedFailure).not.toHaveBeenCalled();
  });

  it('returns a profile action-required state for sessions with single connected profile usage-limit failures', async () => {
    const switchAfterClassifiedFailure = vi.fn();

    await expect(handleConnectedServiceRuntimeAuthFailureForSession({
      getChildren: () => [{
        startedBy: 'daemon',
        happySessionId: 'sess_1',
        pid: 123,
        spawnOptions: {
          directory: '/tmp/project',
          connectedServices: {
            v: 1,
            bindingsByServiceId: {
              'openai-codex': {
                source: 'connected',
                selection: 'profile',
                profileId: 'primary',
              },
            },
          },
        },
      }],
      switchCoordinator: { switchAfterClassifiedFailure },
      sessionId: 'sess_1',
      switchesThisTurn: 0,
      classification: {
        kind: 'usage_limit',
        serviceId: 'openai-codex',
        profileId: 'primary',
        groupId: null,
        resetsAtMs: null,
        planType: null,
        rateLimits: null,
        source: 'structured_provider_error',
      },
    })).resolves.toEqual({
      status: 'recovery_action_required',
      action: {
        kind: 'profile_action_required',
        serviceId: 'openai-codex',
        profileId: 'primary',
        groupId: null,
        reason: 'usage_limit',
      },
    });

    expect(switchAfterClassifiedFailure).not.toHaveBeenCalled();
  });

  it('returns a provider-state-sharing-required action for native Codex usage-limit recovery', async () => {
    const switchAfterClassifiedFailure = vi.fn();
    const refreshConnectedServiceCredentialForRuntimeAuthFailure = vi.fn();

    await expect(handleConnectedServiceRuntimeAuthFailureForSession({
      getChildren: () => [{
        startedBy: 'daemon',
        happySessionId: 'sess_1',
        pid: 123,
        spawnOptions: {
          directory: '/tmp/project',
          connectedServices: {
            v: 1,
            bindingsByServiceId: {
              'openai-codex': {
                source: 'native',
              },
            },
          },
        },
      }],
      switchCoordinator: { switchAfterClassifiedFailure },
      credentialRefreshService: {
        refreshConnectedServiceCredentialForRuntimeAuthFailure,
      },
      sessionId: 'sess_1',
      switchesThisTurn: 0,
      classification: {
        kind: 'usage_limit',
        serviceId: 'openai-codex',
        profileId: null,
        groupId: null,
        resetsAtMs: null,
        planType: null,
        rateLimits: null,
        recoveryAction: { kind: 'provider_state_sharing_required' },
        source: 'structured_provider_error',
      },
    })).resolves.toEqual({
      status: 'recovery_action_required',
      action: {
        kind: 'provider_state_sharing_required',
        serviceId: 'openai-codex',
        profileId: null,
        groupId: null,
        reason: 'usage_limit',
      },
    });

    expect(switchAfterClassifiedFailure).not.toHaveBeenCalled();
    expect(refreshConnectedServiceCredentialForRuntimeAuthFailure).not.toHaveBeenCalled();
  });

  it('uses the tracked auth group to rotate after a Codex provider-state-sharing usage-limit hint', async () => {
    const switchAfterClassifiedFailure = vi.fn(async () => ({
      status: 'switched' as const,
      activeProfileId: 'backup',
      generation: 2,
    }));

    await expect(handleConnectedServiceRuntimeAuthFailureForSession({
      getChildren: () => [{
        startedBy: 'daemon',
        happySessionId: 'sess_1',
        pid: 123,
        spawnOptions: {
          directory: '/tmp/project',
          connectedServices: {
            v: 1,
            bindingsByServiceId: {
              'openai-codex': {
                source: 'connected',
                selection: 'group',
                profileId: 'primary',
                groupId: 'main',
              },
            },
          },
        },
      }],
      switchCoordinator: { switchAfterClassifiedFailure },
      sessionId: 'sess_1',
      switchesThisTurn: 0,
      classification: {
        kind: 'usage_limit',
        serviceId: 'openai-codex',
        profileId: 'primary',
        groupId: 'main',
        resetsAtMs: null,
        planType: null,
        rateLimits: null,
        recoveryAction: { kind: 'provider_state_sharing_required' },
        source: 'structured_provider_error',
      },
    })).resolves.toMatchObject({
      status: 'switch_attempted',
      result: {
        status: 'switched',
        activeProfileId: 'backup',
        generation: 2,
      },
    });

    expect(switchAfterClassifiedFailure).toHaveBeenCalledWith(expect.objectContaining({
      serviceId: 'openai-codex',
      groupId: 'main',
      reason: 'usage_limit',
      observedProfileId: 'primary',
      switchesThisTurn: 0,
    }));
  });

  it('reports an unavailable coordinator at the live daemon boundary without switching', async () => {
    await expect(handleConnectedServiceRuntimeAuthFailureForSession({
      getChildren: () => [{
        startedBy: 'daemon',
        happySessionId: 'sess_1',
        pid: 123,
        spawnOptions: {
          directory: '/tmp/project',
          connectedServices: {
            v: 1,
            bindingsByServiceId: {
              'openai-codex': {
                source: 'connected',
                selection: 'group',
                profileId: 'primary',
                groupId: 'main',
              },
            },
          },
        },
      }],
      switchCoordinator: null,
      sessionId: 'sess_1',
      switchesThisTurn: 0,
      classification: {
        kind: 'usage_limit',
        serviceId: 'openai-codex',
        profileId: 'primary',
        groupId: 'main',
        resetsAtMs: null,
        planType: null,
        rateLimits: null,
        source: 'structured_provider_error',
      },
    })).resolves.toEqual({
      status: 'switch_coordinator_unavailable',
      blocker: 'CLI has no connected-service auth-group load/commit API in this branch.',
    });
  });

  it('carries daemon-observed switch attempts across immediate failed respawns', async () => {
    const switchAttemptTracker = new ConnectedServiceRuntimeAuthSwitchAttemptTracker({
      nowMs: () => 1_000,
      windowMs: 60_000,
    });
    const switchAfterClassifiedFailure = vi.fn(async ({ switchesThisTurn }: { switchesThisTurn?: number }) => (
      switchesThisTurn === 0
        ? { status: 'switched' as const, activeProfileId: 'backup', generation: 2 }
        : { status: 'switch_limit_reached' as const, generation: 2 }
    ));
    const trackedSession = {
      startedBy: 'daemon' as const,
      happySessionId: 'sess_1',
      pid: 123,
      spawnOptions: {
        directory: '/tmp/project',
        connectedServices: {
          v: 1 as const,
          bindingsByServiceId: {
            'openai-codex': {
              source: 'connected' as const,
              selection: 'group' as const,
              profileId: 'primary',
              groupId: 'main',
            },
          },
        },
      },
    };
    const classification = {
      kind: 'usage_limit' as const,
      serviceId: 'openai-codex',
      profileId: 'primary',
      groupId: 'main',
      resetsAtMs: null,
      planType: null,
      rateLimits: null,
      source: 'structured_provider_error' as const,
    };

    await expect(handleConnectedServiceRuntimeAuthFailureForSession({
      getChildren: () => [trackedSession],
      switchCoordinator: { switchAfterClassifiedFailure },
      switchAttemptTracker,
      sessionId: 'sess_1',
      switchesThisTurn: 0,
      classification,
    })).resolves.toMatchObject({
      status: 'switch_attempted',
      result: { status: 'switched', activeProfileId: 'backup', generation: 2 },
    });

    await expect(handleConnectedServiceRuntimeAuthFailureForSession({
      getChildren: () => [trackedSession],
      switchCoordinator: { switchAfterClassifiedFailure },
      switchAttemptTracker,
      sessionId: 'sess_1',
      switchesThisTurn: 0,
      classification,
    })).resolves.toMatchObject({
      status: 'switch_attempted',
      result: { status: 'switch_limit_reached', generation: 2 },
    });

    expect(switchAfterClassifiedFailure).toHaveBeenNthCalledWith(1, expect.objectContaining({
      switchesThisTurn: 0,
    }));
    expect(switchAfterClassifiedFailure).toHaveBeenNthCalledWith(2, expect.objectContaining({
      switchesThisTurn: 1,
    }));
  });

  it('honors hourly switch limits across separate daemon requests even when the switch coordinator instance is recreated', async () => {
    let current = {
      serviceId: 'openai-codex',
      groupId: 'main',
      activeProfileId: 'primary',
      generation: 1,
      policy: {
        ...DEFAULT_CONNECTED_SERVICE_AUTH_GROUP_POLICY_V1,
        strategy: 'priority' as const,
        autoSwitch: true,
        maxSwitchesPerTurn: 2,
        maxSwitchesPerSessionHour: 1,
      },
      members: [
        { profileId: 'primary', priority: 1, createdAtMs: 1, enabled: true },
        { profileId: 'backup', priority: 2, createdAtMs: 2, enabled: true },
      ],
      memberStatesByProfileId: new Map(),
    };
    const switchAttemptTracker = new ConnectedServiceRuntimeAuthSwitchAttemptTracker({
      nowMs: () => 1_000,
      windowMs: 60_000,
    });
    const trackedSession = {
      startedBy: 'daemon' as const,
      happySessionId: 'sess_1',
      pid: 123,
      spawnOptions: {
        directory: '/tmp/project',
        connectedServices: {
          v: 1 as const,
          bindingsByServiceId: {
            'openai-codex': {
              source: 'connected' as const,
              selection: 'group' as const,
              profileId: 'primary',
              groupId: 'main',
            },
          },
        },
      },
    };
    const classification = {
      kind: 'usage_limit' as const,
      serviceId: 'openai-codex',
      profileId: 'primary',
      groupId: 'main',
      resetsAtMs: null,
      planType: null,
      rateLimits: null,
      source: 'structured_provider_error' as const,
    };
    const createFreshCoordinator = () => new ConnectedServiceAuthGroupSwitchCoordinator({
      leases: new InMemoryConnectedServiceAuthGroupSwitchLeaseRegistry(),
      nowMs: () => 1_000,
      quotaFreshnessMs: 60_000,
      loadState: async () => current,
      commitSwitch: async ({ toProfileId }) => {
        current = {
          ...current,
          activeProfileId: toProfileId,
          generation: current.generation + 1,
        };
        return current;
      },
      applyGeneration: async () => {},
    });

    await expect(handleConnectedServiceRuntimeAuthFailureForSession({
      getChildren: () => [trackedSession],
      switchCoordinator: createFreshCoordinator(),
      switchAttemptTracker,
      sessionId: 'sess_1',
      switchesThisTurn: 0,
      classification,
    })).resolves.toMatchObject({
      status: 'switch_attempted',
      result: { status: 'switched', activeProfileId: 'backup', generation: 2 },
    });

    await expect(handleConnectedServiceRuntimeAuthFailureForSession({
      getChildren: () => [trackedSession],
      switchCoordinator: createFreshCoordinator(),
      switchAttemptTracker,
      sessionId: 'sess_1',
      switchesThisTurn: 0,
      classification,
    })).resolves.toMatchObject({
      status: 'switch_attempted',
      result: { status: 'observed_generation', generation: 2, activeProfileId: 'backup' },
    });
  });
});
