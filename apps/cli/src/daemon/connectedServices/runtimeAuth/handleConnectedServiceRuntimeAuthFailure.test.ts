import { describe, expect, it, vi } from 'vitest';

import { handleConnectedServiceRuntimeAuthFailure } from './handleConnectedServiceRuntimeAuthFailure';

describe('handleConnectedServiceRuntimeAuthFailure', () => {
  it('returns a profile action-required state for a single connected profile usage-limit failure', async () => {
    const switchAfterClassifiedFailure = vi.fn();

    await expect(handleConnectedServiceRuntimeAuthFailure({
      selection: {
        kind: 'profile',
        serviceId: 'openai-codex',
        profileId: 'work',
      },
      classification: {
        kind: 'usage_limit',
        limitCategory: 'usage_limit',
        serviceId: 'openai-codex',
        profileId: 'work',
        groupId: 'main',
        resetsAtMs: null,
        retryAfterMs: 60_000,
        quotaScope: 'account',
        providerLimitId: 'weekly',
        action: { kind: 'open_url', url: 'https://chatgpt.com/codex/settings/usage' },
        planType: null,
        rateLimits: null,
        source: 'structured_provider_error',
      },
      switchesThisTurn: 0,
      switchCoordinator: { switchAfterClassifiedFailure },
    })).resolves.toEqual({
      status: 'recovery_action_required',
      action: {
        kind: 'profile_action_required',
        serviceId: 'openai-codex',
        profileId: 'work',
        groupId: 'main',
        reason: 'usage_limit',
      },
    });

    expect(switchAfterClassifiedFailure).not.toHaveBeenCalled();
  });

  it('returns reconnect-required only for a single connected profile credential failure', async () => {
    const switchAfterClassifiedFailure = vi.fn();

    await expect(handleConnectedServiceRuntimeAuthFailure({
      selection: {
        kind: 'profile',
        serviceId: 'openai-codex',
        profileId: 'work',
      },
      classification: {
        kind: 'auth_expired',
        serviceId: 'openai-codex',
        profileId: 'work',
        groupId: null,
        resetsAtMs: null,
        planType: null,
        rateLimits: null,
        source: 'structured_provider_error',
      },
      switchesThisTurn: 0,
      switchCoordinator: { switchAfterClassifiedFailure },
    })).resolves.toEqual({
      status: 'recovery_action_required',
      action: {
        kind: 'reconnect_profile',
        serviceId: 'openai-codex',
        profileId: 'work',
        groupId: null,
        reason: 'auth_expired',
      },
    });

    expect(switchAfterClassifiedFailure).not.toHaveBeenCalled();
  });

  it('returns a provider-state-sharing-required action for native Codex usage-limit recovery', async () => {
    const switchAfterClassifiedFailure = vi.fn();

    await expect(handleConnectedServiceRuntimeAuthFailure({
      selection: null,
      classification: {
        kind: 'usage_limit',
        limitCategory: 'usage_limit',
        serviceId: 'openai-codex',
        profileId: null,
        groupId: null,
        resetsAtMs: null,
        planType: null,
        rateLimits: null,
        source: 'structured_provider_error',
        recoveryAction: { kind: 'provider_state_sharing_required' },
      },
      switchesThisTurn: 0,
      switchCoordinator: { switchAfterClassifiedFailure },
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
  });

  it('uses provider-owned recovery action hints for native usage-limit recovery', async () => {
    const switchAfterClassifiedFailure = vi.fn();
    const classification = {
      kind: 'usage_limit' as const,
      limitCategory: 'usage_limit' as const,
      serviceId: 'provider-owned-service',
      profileId: null,
      groupId: null,
      resetsAtMs: null,
      planType: null,
      rateLimits: null,
      source: 'structured_provider_error' as const,
      recoveryAction: { kind: 'provider_state_sharing_required' as const },
    };

    await expect(handleConnectedServiceRuntimeAuthFailure({
      selection: null,
      classification,
      switchesThisTurn: 0,
      switchCoordinator: { switchAfterClassifiedFailure },
    })).resolves.toEqual({
      status: 'recovery_action_required',
      action: {
        kind: 'provider_state_sharing_required',
        serviceId: 'provider-owned-service',
        profileId: null,
        groupId: null,
        reason: 'usage_limit',
      },
    });

    expect(switchAfterClassifiedFailure).not.toHaveBeenCalled();
  });

  it('prefers group switching over provider-owned shared-state recovery hints', async () => {
    const switchAfterClassifiedFailure = vi.fn(async () => ({
      status: 'switched' as const,
      activeProfileId: 'backup',
      generation: 2,
    }));

    await expect(handleConnectedServiceRuntimeAuthFailure({
      selection: {
        kind: 'group',
        serviceId: 'openai-codex',
        groupId: 'main',
        activeProfileId: 'work',
      },
      classification: {
        kind: 'usage_limit',
        limitCategory: 'usage_limit',
        serviceId: 'openai-codex',
        profileId: 'work',
        groupId: 'main',
        resetsAtMs: null,
        planType: null,
        rateLimits: null,
        source: 'structured_provider_error',
        recoveryAction: { kind: 'provider_state_sharing_required' },
      },
      switchesThisTurn: 0,
      switchCoordinator: { switchAfterClassifiedFailure },
    })).resolves.toEqual({
      status: 'switch_attempted',
      result: {
        status: 'switched',
        activeProfileId: 'backup',
        generation: 2,
      },
    });

    expect(switchAfterClassifiedFailure).toHaveBeenCalledWith({
      serviceId: 'openai-codex',
      groupId: 'main',
      reason: 'usage_limit',
      observedProfileId: 'work',
      retryAfterMs: undefined,
      resetsAtMs: null,
      limitCategory: 'usage_limit',
      quotaScope: undefined,
      providerLimitId: undefined,
      action: undefined,
      planType: null,
      switchesThisTurn: 0,
      sessionSwitchesThisHour: undefined,
    });
  });

  it('passes classified group failures to the group switch coordinator', async () => {
    const switchAfterClassifiedFailure = vi.fn(async () => ({
      status: 'switched' as const,
      activeProfileId: 'backup',
      generation: 2,
    }));

    await expect(handleConnectedServiceRuntimeAuthFailure({
      selection: {
        kind: 'group',
        serviceId: 'openai-codex',
        groupId: 'main',
        activeProfileId: 'work',
      },
      classification: {
        kind: 'usage_limit',
        limitCategory: 'usage_limit',
        serviceId: 'openai-codex',
        profileId: 'work',
        groupId: 'main',
        resetsAtMs: null,
        retryAfterMs: 60_000,
        quotaScope: 'account',
        providerLimitId: 'weekly',
        action: { kind: 'open_url', url: 'https://chatgpt.com/codex/settings/usage' },
        planType: null,
        rateLimits: null,
        source: 'structured_provider_error',
      },
      switchesThisTurn: 0,
      switchCoordinator: { switchAfterClassifiedFailure },
    })).resolves.toEqual({
      status: 'switch_attempted',
      result: {
        status: 'switched',
        activeProfileId: 'backup',
        generation: 2,
      },
    });

    expect(switchAfterClassifiedFailure).toHaveBeenCalledWith({
      serviceId: 'openai-codex',
      groupId: 'main',
      reason: 'usage_limit',
      observedProfileId: 'work',
      retryAfterMs: 60_000,
      resetsAtMs: null,
      limitCategory: 'usage_limit',
      quotaScope: 'account',
      providerLimitId: 'weekly',
      action: { kind: 'open_url', url: 'https://chatgpt.com/codex/settings/usage' },
      planType: null,
      switchesThisTurn: 0,
    });
  });
});
