import { beforeEach, describe, expect, it, vi } from 'vitest';

const { releaseForAuthSwitchMock } = vi.hoisted(() => ({
  releaseForAuthSwitchMock: vi.fn(async () => ({ released: true as const, reason: 'released' as const })),
}));

vi.mock('@/backends/opencode/server/sharedManagedServer', () => ({
  releaseForAuthSwitch: releaseForAuthSwitchMock,
}));

import {
  createOpenCodeConnectedServiceRuntimeAuthAdapter,
  resolveOpenCodeRuntimeAuthSelection,
} from './createOpenCodeConnectedServiceRuntimeAuthAdapter';

describe('createOpenCodeConnectedServiceRuntimeAuthAdapter', () => {
  beforeEach(() => {
    releaseForAuthSwitchMock.mockReset();
    releaseForAuthSwitchMock.mockResolvedValue({ released: true as const, reason: 'released' as const });
  });

  it('releases the prior managed server after an auth switch when prior fingerprint context is present', async () => {
    const adapter = createOpenCodeConnectedServiceRuntimeAuthAdapter();

    await expect(adapter.recoverAfterRuntimeAuthSwitch({
      target: { agentId: 'opencode' },
      selection: {
        serviceId: 'openai-codex',
        previousLaunchFingerprint: 'previous-fingerprint',
        previousOwnerToken: 'owner-token-1',
      },
    })).resolves.toMatchObject({
      recovered: true,
      recovery: 'restart_rematerialize',
      detached: true,
      detachedReason: 'released',
    });

    expect(releaseForAuthSwitchMock).toHaveBeenCalledWith('previous-fingerprint', 'owner-token-1');
  });

  it('does not try to release managed servers when prior fingerprint context is missing', async () => {
    const adapter = createOpenCodeConnectedServiceRuntimeAuthAdapter();

    await expect(adapter.recoverAfterRuntimeAuthSwitch({
      target: { agentId: 'opencode' },
      selection: { serviceId: 'openai-codex' },
    })).resolves.toMatchObject({
      recovered: true,
      recovery: 'restart_rematerialize',
      detached: false,
      detachedReason: 'prior_launch_fingerprint_missing',
    });

    expect(releaseForAuthSwitchMock).not.toHaveBeenCalled();
  });

  it('does not classify usage-limit errors as connected-service incidents without a concrete OpenCode binding', () => {
    const adapter = createOpenCodeConnectedServiceRuntimeAuthAdapter();

    expect(adapter.classifyRuntimeAuthFailure({
      target: { agentId: 'opencode', targetId: 'session-1' },
      error: { name: 'FreeUsageLimitError', message: 'rate limited' },
      selection: null,
    })).toBeNull();
  });

  it('resolves serialized selection context with provider-owned precedence including Claude subscription', () => {
    expect(resolveOpenCodeRuntimeAuthSelection({
      selections: [
        { kind: 'profile', serviceId: 'anthropic', profileId: 'anthropic-profile' },
        { kind: 'group', serviceId: 'claude-subscription', groupId: 'team-claude', activeProfileId: 'claude-profile' },
      ],
      error: { name: 'FreeUsageLimitError', message: 'rate limited' },
    })).toEqual({
      kind: 'group',
      serviceId: 'claude-subscription',
      groupId: 'team-claude',
      activeProfileId: 'claude-profile',
    });
  });
});
