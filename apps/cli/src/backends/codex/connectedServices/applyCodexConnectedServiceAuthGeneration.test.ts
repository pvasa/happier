import { describe, expect, it, vi } from 'vitest';

import { buildConnectedServiceCredentialRecord } from '@happier-dev/protocol';

import {
  applyCodexConnectedServiceAuthGeneration,
  evaluateCodexConnectedServiceHotApplyEligibility,
  recoverCodexConnectedServiceRestartResumeOnce,
} from './applyCodexConnectedServiceAuthGeneration';

describe('Codex connected-service runtime auth application', () => {
  it('rejects forced-workspace mismatches before mutating live auth', async () => {
    const candidate = buildConnectedServiceCredentialRecord({
      now: 1000,
      serviceId: 'openai-codex',
      profileId: 'personal',
      kind: 'oauth',
      expiresAt: 2000,
      oauth: {
        accessToken: 'access',
        refreshToken: 'refresh',
        idToken: 'id',
        scope: null,
        tokenType: null,
        providerAccountId: 'workspace-personal',
        providerEmail: null,
      },
    });
    const client = { request: vi.fn() };

    const result = await applyCodexConnectedServiceAuthGeneration({
      client,
      candidate,
      forcedWorkspaceId: 'workspace-work',
    });

    expect(result).toEqual({ applied: false, reason: 'workspace_incompatible' });
    expect(client.request).not.toHaveBeenCalled();
  });

  it('hot-applies same-family ChatGPT token credentials through account/login/start', async () => {
    const candidate = buildConnectedServiceCredentialRecord({
      now: 1000,
      serviceId: 'openai-codex',
      profileId: 'work',
      kind: 'oauth',
      expiresAt: 2000,
      oauth: {
        accessToken: 'access',
        refreshToken: 'refresh',
        idToken: 'id',
        scope: null,
        tokenType: null,
        providerAccountId: 'workspace-work',
        providerEmail: null,
      },
    });
    const client = { request: vi.fn(async () => ({ ok: true })) };
    const invalidateTransports = vi.fn(async () => {});
    const persistAuthStore = vi.fn(async () => {});

    await expect(applyCodexConnectedServiceAuthGeneration({
      client,
      candidate,
      forcedWorkspaceId: 'workspace-work',
      invalidateTransports,
      persistAuthStore,
    })).resolves.toEqual({ applied: true, via: 'hot' });

    expect(client.request).toHaveBeenCalledWith('account/login/start', {
      type: 'chatgptAuthTokens',
      accessToken: 'access',
      chatgptAccountId: 'workspace-work',
    });
    expect(persistAuthStore).toHaveBeenCalledOnce();
    expect(invalidateTransports).toHaveBeenCalledOnce();
    // Durable adoption must land in the auth store BEFORE transports are
    // recycled: the session app-server re-reads auth.json on invalidation.
    expect(persistAuthStore.mock.invocationCallOrder[0]!)
      .toBeLessThan(invalidateTransports.mock.invocationCallOrder[0]!);
  });

  it('requires a durable auth-store persistence hook before reporting hot auth apply as safe', async () => {
    const candidate = buildConnectedServiceCredentialRecord({
      now: 1000,
      serviceId: 'openai-codex',
      profileId: 'work',
      kind: 'oauth',
      expiresAt: 2000,
      oauth: {
        accessToken: 'access',
        refreshToken: 'refresh',
        idToken: 'id',
        scope: null,
        tokenType: null,
        providerAccountId: 'workspace-work',
        providerEmail: null,
      },
    });
    const client = { request: vi.fn(async () => ({ ok: true })) };
    const invalidateTransports = vi.fn(async () => {});

    await expect(applyCodexConnectedServiceAuthGeneration({
      client,
      candidate,
      forcedWorkspaceId: 'workspace-work',
      invalidateTransports,
    })).resolves.toEqual({
      applied: false,
      reason: 'auth_store_persistence_unavailable',
      recovery: 'restart_resume',
    });

    expect(client.request).not.toHaveBeenCalled();
    expect(invalidateTransports).not.toHaveBeenCalled();
  });

  it('falls back to restart/resume when the auth-store write fails after login/start', async () => {
    const candidate = buildConnectedServiceCredentialRecord({
      now: 1000,
      serviceId: 'openai-codex',
      profileId: 'work',
      kind: 'oauth',
      expiresAt: 2000,
      oauth: {
        accessToken: 'access',
        refreshToken: 'refresh',
        idToken: 'id',
        scope: null,
        tokenType: null,
        providerAccountId: 'workspace-work',
        providerEmail: null,
      },
    });
    const client = { request: vi.fn(async () => ({ ok: true })) };
    const invalidateTransports = vi.fn(async () => {});
    const persistAuthStore = vi.fn(async () => {
      throw new Error('disk full');
    });

    await expect(applyCodexConnectedServiceAuthGeneration({
      client,
      candidate,
      forcedWorkspaceId: 'workspace-work',
      invalidateTransports,
      persistAuthStore,
    })).resolves.toEqual({
      applied: false,
      reason: 'auth_store_persistence_failed',
      recovery: 'restart_resume',
    });

    expect(client.request).toHaveBeenCalledOnce();
    expect(invalidateTransports).not.toHaveBeenCalled();
  });

  it('requires an explicit transport invalidation hook before reporting hot auth apply as safe', async () => {
    const candidate = buildConnectedServiceCredentialRecord({
      now: 1000,
      serviceId: 'openai-codex',
      profileId: 'work',
      kind: 'oauth',
      expiresAt: 2000,
      oauth: {
        accessToken: 'access',
        refreshToken: 'refresh',
        idToken: 'id',
        scope: null,
        tokenType: null,
        providerAccountId: 'workspace-work',
        providerEmail: null,
      },
    });
    const client = { request: vi.fn(async () => ({ ok: true })) };

    await expect(applyCodexConnectedServiceAuthGeneration({
      client,
      candidate,
      forcedWorkspaceId: 'workspace-work',
    })).resolves.toEqual({
      applied: false,
      reason: 'transport_invalidation_unavailable',
      recovery: 'restart_resume',
    });

    expect(client.request).not.toHaveBeenCalled();
  });

  it('falls back to restart/resume when transport invalidation fails after login/start', async () => {
    const candidate = buildConnectedServiceCredentialRecord({
      now: 1000,
      serviceId: 'openai-codex',
      profileId: 'work',
      kind: 'oauth',
      expiresAt: 2000,
      oauth: {
        accessToken: 'access',
        refreshToken: 'refresh',
        idToken: 'id',
        scope: null,
        tokenType: null,
        providerAccountId: 'workspace-work',
        providerEmail: null,
      },
    });
    const client = { request: vi.fn(async () => ({ ok: true })) };
    const invalidateTransports = vi.fn(async () => {
      throw new Error('transport is gone');
    });

    await expect(applyCodexConnectedServiceAuthGeneration({
      client,
      candidate,
      forcedWorkspaceId: 'workspace-work',
      invalidateTransports,
      persistAuthStore: async () => {},
    })).resolves.toEqual({
      applied: false,
      reason: 'transport_invalidation_failed',
      recovery: 'restart_resume',
    });

    expect(client.request).toHaveBeenCalledOnce();
    expect(invalidateTransports).toHaveBeenCalledOnce();
  });

  it('marks API-key or native auth-family transitions as restart-only', () => {
    const candidate = buildConnectedServiceCredentialRecord({
      now: 1000,
      serviceId: 'openai',
      profileId: 'api',
      kind: 'token',
      token: { token: 'sk-openai', providerAccountId: null, providerEmail: null },
    });

    expect(evaluateCodexConnectedServiceHotApplyEligibility({
      candidate,
      forcedWorkspaceId: null,
    })).toEqual({ eligible: false, reason: 'auth_family_mismatch' });
  });

  it('bounds restart/resume recovery to one attempt', async () => {
    const restartAndResume = vi.fn(async () => ({ resumed: true as const }));

    await expect(recoverCodexConnectedServiceRestartResumeOnce({
      attemptsSoFar: 0,
      restartAndResume,
    })).resolves.toEqual({ recovered: true, via: 'restart' });
    await expect(recoverCodexConnectedServiceRestartResumeOnce({
      attemptsSoFar: 1,
      restartAndResume,
    })).resolves.toEqual({ recovered: false, reason: 'retry_limit_reached' });
    expect(restartAndResume).toHaveBeenCalledTimes(1);
  });
});
