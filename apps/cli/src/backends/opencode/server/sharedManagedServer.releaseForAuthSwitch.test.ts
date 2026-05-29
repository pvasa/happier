import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import {
  decideManagedOpenCodeStartupScanOrphanReapAction,
  decideManagedOpenCodeStartupScanStateAction,
  releaseForAuthSwitchFromState,
  type SharedManagedOpenCodeServerState,
} from './sharedManagedServer';

function hashCommandLine(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function buildState(overrides: Partial<SharedManagedOpenCodeServerState> = {}): SharedManagedOpenCodeServerState {
  return {
    v: 2,
    baseUrl: 'http://127.0.0.1:43111',
    pid: 777,
    startedAtMs: 100,
    status: 'ready',
    launchEnvFingerprint: 'fingerprint-a',
    ownerToken: 'owner-token-a',
    startTimeMs: 2500,
    expectedCmdlineHash: hashCommandLine('opencode serve --hostname=127.0.0.1 --port=43111'),
    activeServerDir: '/tmp/happy/servers/cloud',
    daemonInstanceId: 'cloud',
    ...overrides,
  };
}

describe('releaseForAuthSwitchFromState', () => {
  it('releases a validated prior managed server during auth switch', async () => {
    const state = buildState();
    const killPid = vi.fn(async () => true);
    const removeState = vi.fn(async () => {});

    const result = await releaseForAuthSwitchFromState({
      withLock: async <T>(fn: () => Promise<T>) => await fn(),
      readState: async () => state,
      removeState,
      isPidAlive: () => true,
      getProcessInfo: async () => ({ name: 'opencode', cmd: 'opencode serve --hostname=127.0.0.1 --port=43111' }),
      readProcessStartTimeMs: async () => 2501,
      killPid,
      currentActiveServerDir: '/tmp/happy/servers/cloud',
      currentDaemonInstanceId: 'cloud',
      expectedOwnerToken: 'owner-token-a',
      drainMs: 9_000,
    });

    expect(result).toEqual({ released: true, reason: 'released' });
    expect(killPid).toHaveBeenCalledWith(777, 9_000);
    expect(removeState).toHaveBeenCalledTimes(1);
  });

  it('drops stale state without signaling when owner token mismatches', async () => {
    const state = buildState();
    const killPid = vi.fn(async () => true);
    const removeState = vi.fn(async () => {});

    const result = await releaseForAuthSwitchFromState({
      withLock: async <T>(fn: () => Promise<T>) => await fn(),
      readState: async () => state,
      removeState,
      isPidAlive: () => true,
      getProcessInfo: async () => ({ name: 'opencode', cmd: 'opencode serve --hostname=127.0.0.1 --port=43111' }),
      readProcessStartTimeMs: async () => 2500,
      killPid,
      currentActiveServerDir: '/tmp/happy/servers/cloud',
      currentDaemonInstanceId: 'cloud',
      expectedOwnerToken: 'another-owner-token',
      drainMs: 9_000,
    });

    expect(result).toEqual({ released: false, reason: 'owner_token_mismatch' });
    expect(killPid).not.toHaveBeenCalled();
    expect(removeState).toHaveBeenCalledTimes(1);
  });

  it('drops stale state without signaling when process validation fails (PID reuse safety)', async () => {
    const state = buildState();
    const killPid = vi.fn(async () => true);
    const removeState = vi.fn(async () => {});

    const result = await releaseForAuthSwitchFromState({
      withLock: async <T>(fn: () => Promise<T>) => await fn(),
      readState: async () => state,
      removeState,
      isPidAlive: () => true,
      getProcessInfo: async () => ({ name: 'opencode', cmd: 'python unrelated-worker.py' }),
      readProcessStartTimeMs: async () => 2500,
      killPid,
      currentActiveServerDir: '/tmp/happy/servers/cloud',
      currentDaemonInstanceId: 'cloud',
      expectedOwnerToken: 'owner-token-a',
      drainMs: 9_000,
    });

    expect(result).toEqual({ released: false, reason: 'process_identity_mismatch' });
    expect(killPid).not.toHaveBeenCalled();
    expect(removeState).toHaveBeenCalledTimes(1);
  });

  it('drops untrusted v1 state files without signaling', async () => {
    const state = buildState({ v: undefined, ownerToken: undefined, expectedCmdlineHash: undefined });
    const killPid = vi.fn(async () => true);
    const removeState = vi.fn(async () => {});

    const result = await releaseForAuthSwitchFromState({
      withLock: async <T>(fn: () => Promise<T>) => await fn(),
      readState: async () => state,
      removeState,
      isPidAlive: () => true,
      getProcessInfo: async () => ({ name: 'opencode', cmd: 'opencode serve --hostname=127.0.0.1 --port=43111' }),
      readProcessStartTimeMs: async () => 2500,
      killPid,
      currentActiveServerDir: '/tmp/happy/servers/cloud',
      currentDaemonInstanceId: 'cloud',
      expectedOwnerToken: 'owner-token-a',
      drainMs: 9_000,
    });

    expect(result).toEqual({ released: false, reason: 'state_untrusted' });
    expect(killPid).not.toHaveBeenCalled();
    expect(removeState).toHaveBeenCalledTimes(1);
  });

  it('does not reap when another tracked session still claims the same launch fingerprint', async () => {
    const state = buildState();
    const killPid = vi.fn(async () => true);
    const removeState = vi.fn(async () => {});

    const result = await releaseForAuthSwitchFromState({
      withLock: async <T>(fn: () => Promise<T>) => await fn(),
      readState: async () => state,
      removeState,
      isPidAlive: () => true,
      getProcessInfo: async () => ({ name: 'opencode', cmd: 'opencode serve --hostname=127.0.0.1 --port=43111' }),
      readProcessStartTimeMs: async () => 2500,
      killPid,
      currentActiveServerDir: '/tmp/happy/servers/cloud',
      currentDaemonInstanceId: 'cloud',
      expectedOwnerToken: 'owner-token-a',
      drainMs: 9_000,
      trackedClaimCountForLaunchFingerprint: async () => 2,
      allowCurrentSessionClaim: true,
    });

    expect(result).toEqual({ released: false, reason: 'tracked_session_claimed' });
    expect(killPid).not.toHaveBeenCalled();
    expect(removeState).not.toHaveBeenCalled();
  });

  it('allows release when only the current switching session is known as an active claim', async () => {
    const state = buildState();
    const killPid = vi.fn(async () => true);
    const removeState = vi.fn(async () => {});

    const result = await releaseForAuthSwitchFromState({
      withLock: async <T>(fn: () => Promise<T>) => await fn(),
      readState: async () => state,
      removeState,
      isPidAlive: () => true,
      getProcessInfo: async () => ({ name: 'opencode', cmd: 'opencode serve --hostname=127.0.0.1 --port=43111' }),
      readProcessStartTimeMs: async () => 2500,
      killPid,
      currentActiveServerDir: '/tmp/happy/servers/cloud',
      currentDaemonInstanceId: 'cloud',
      expectedOwnerToken: 'owner-token-a',
      drainMs: 9_000,
      trackedClaimCountForLaunchFingerprint: async () => 1,
      allowCurrentSessionClaim: true,
    });

    expect(result).toEqual({ released: true, reason: 'released' });
    expect(killPid).toHaveBeenCalledWith(777, 9_000);
    expect(removeState).toHaveBeenCalledTimes(1);
  });
});

describe('decideManagedOpenCodeStartupScanStateAction', () => {
  it('drops trusted state when live process identity no longer matches (PID reuse safety)', () => {
    const state = buildState();
    const decision = decideManagedOpenCodeStartupScanStateAction({
      state,
      currentDaemonInstanceId: 'cloud',
      currentActiveServerDir: '/tmp/happy/servers/cloud',
      isPidAlive: true,
      processInfo: { name: 'python', cmd: 'python unrelated-worker.py' },
      observedStartTimeMs: 2500,
    });

    expect(decision).toEqual({ action: 'drop', reason: 'process_identity_mismatch' });
  });
});

describe('decideManagedOpenCodeStartupScanOrphanReapAction', () => {
  it('reaps only when a verified live non-current fingerprint has no tracked claim', () => {
    expect(decideManagedOpenCodeStartupScanOrphanReapAction({
      stateDecision: { action: 'keep', reason: 'verified_live_state' },
      trackedClaimCount: 0,
      hasUnknownOpenCodeTrackedClaims: false,
    })).toEqual({ action: 'reap', reason: 'no_tracked_claims' });
  });

  it('keeps verified state when a tracked session claims the fingerprint', () => {
    expect(decideManagedOpenCodeStartupScanOrphanReapAction({
      stateDecision: { action: 'keep', reason: 'verified_live_state' },
      trackedClaimCount: 1,
      hasUnknownOpenCodeTrackedClaims: false,
    })).toEqual({ action: 'keep', reason: 'tracked_session_claimed' });
  });

  it('keeps verified state when tracked OpenCode sessions exist but fingerprint claim is unknown', () => {
    expect(decideManagedOpenCodeStartupScanOrphanReapAction({
      stateDecision: { action: 'keep', reason: 'verified_live_state' },
      trackedClaimCount: 0,
      hasUnknownOpenCodeTrackedClaims: true,
    })).toEqual({ action: 'keep', reason: 'tracked_claim_unknown' });
  });

  it('propagates drop decisions without attempting orphan reaping logic', () => {
    expect(decideManagedOpenCodeStartupScanOrphanReapAction({
      stateDecision: { action: 'drop', reason: 'state_untrusted' },
      trackedClaimCount: 0,
      hasUnknownOpenCodeTrackedClaims: false,
    })).toEqual({ action: 'drop', reason: 'state_untrusted' });
  });
});
