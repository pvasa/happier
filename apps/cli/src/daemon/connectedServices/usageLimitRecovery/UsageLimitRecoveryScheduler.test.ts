import { describe, expect, it, vi } from 'vitest';

import {
  SESSION_USAGE_LIMIT_RECOVERY_METADATA_KEY,
  SESSION_USAGE_LIMIT_RECOVERY_STATE_FIELD_ID,
  SessionUsageLimitRecoveryV1Schema,
} from '@happier-dev/protocol';

import {
  METADATA_SESSION_USAGE_LIMIT_RECOVERY_V1_KEY,
  RUNTIME_USAGE_LIMIT_RECOVERY_FIELD,
  UsageLimitRecoveryScheduler,
} from './UsageLimitRecoveryScheduler';

describe('UsageLimitRecoveryScheduler', () => {
  it('stores one active intent per session and supersedes older intents', async () => {
    const scheduler = new UsageLimitRecoveryScheduler({ nowMs: () => 1_000 });

    await scheduler.enable({
      sessionId: 'session-1',
      issueFingerprint: 'old',
      resetAtMs: 2_000,
      selectedAuth: { kind: 'profile', serviceId: 'openai-codex', profileId: 'work' },
    });
    const intent = await scheduler.enable({
      sessionId: 'session-1',
      issueFingerprint: 'new',
      resetAtMs: 3_000,
      selectedAuth: { kind: 'profile', serviceId: 'openai-codex', profileId: 'work' },
    });

    expect(intent.issueFingerprint).toBe('new');
    expect(scheduler.read('session-1')?.resetAtMs).toBe(3_000);
    expect(RUNTIME_USAGE_LIMIT_RECOVERY_FIELD).toBe(SESSION_USAGE_LIMIT_RECOVERY_STATE_FIELD_ID);
    expect(METADATA_SESSION_USAGE_LIMIT_RECOVERY_V1_KEY).toBe(SESSION_USAGE_LIMIT_RECOVERY_METADATA_KEY);
    expect(SessionUsageLimitRecoveryV1Schema.safeParse(intent).success).toBe(true);
  });

  it('cancels active intents', async () => {
    const scheduler = new UsageLimitRecoveryScheduler({ nowMs: () => 1_000 });
    await scheduler.enable({
      sessionId: 'session-1',
      issueFingerprint: 'issue',
      resetAtMs: 2_000,
      selectedAuth: { kind: 'native' },
    });

    await scheduler.cancel({ sessionId: 'session-1' });

    expect(scheduler.read('session-1')?.status).toBe('cancelled');
  });

  it('re-runs group recovery on wake instead of retrying the old profile directly', async () => {
    const selectedProfiles: string[] = [];
    const scheduler = new UsageLimitRecoveryScheduler({
      nowMs: () => 2_000,
      recover: async (intent) => {
        if (intent.selectedAuth.kind !== 'group') throw new Error('expected group intent');
        selectedProfiles.push(intent.selectedAuth.profileId);
        return {
          status: 'ready',
          selectedAuth: {
            ...intent.selectedAuth,
            profileId: 'fresh-member',
          },
        };
      },
      resume: async () => {},
    });
    await scheduler.enable({
      sessionId: 'session-1',
      issueFingerprint: 'limit',
      resetAtMs: 2_000,
      selectedAuth: {
        kind: 'group',
        serviceId: 'openai-codex',
        groupId: 'main',
        profileId: 'old-member',
      },
    });

    const result = await scheduler.wake({ sessionId: 'session-1', reason: 'timer' });

    expect(result.status).toBe('resumed');
    expect(selectedProfiles).toEqual(['old-member']);
    expect(scheduler.read('session-1')?.status).toBe('cancelled');
    expect(scheduler.read('session-1')?.selectedAuth).toMatchObject({
      kind: 'group',
      profileId: 'fresh-member',
    });
    expect(SessionUsageLimitRecoveryV1Schema.safeParse(scheduler.read('session-1')).success).toBe(true);
  });

  it('records a daemon restart diagnostic before resuming usage-limit recovery', async () => {
    const records: unknown[] = [];
    const resume = vi.fn(async () => {});
    const deps = {
      nowMs: () => 2_000,
      recover: async () => ({ status: 'ready' as const }),
      resume,
      recordRestartDiagnostic: (record: unknown) => records.push(record),
    } satisfies ConstructorParameters<typeof UsageLimitRecoveryScheduler>[0];
    const scheduler = new UsageLimitRecoveryScheduler(deps);
    await scheduler.enable({
      sessionId: 'session-1',
      issueFingerprint: 'limit',
      resetAtMs: 2_000,
      selectedAuth: {
        kind: 'group',
        serviceId: 'openai-codex',
        groupId: 'main',
        profileId: 'primary',
      },
    });

    await expect(scheduler.wake({ sessionId: 'session-1', reason: 'timer' })).resolves.toEqual({
      status: 'resumed',
    });

    expect(resume).toHaveBeenCalledOnce();
    expect(records).toEqual([{
      type: 'connected_service_daemon_restart',
      trigger: 'usage_limit_recovery',
      status: 'requested',
      sessionId: 'session-1',
      agentId: null,
      serviceId: 'openai-codex',
      profileId: 'primary',
      groupId: 'main',
      generation: null,
      reason: 'limit',
      pid: null,
      processGroupPid: null,
      delayMs: null,
      atMs: 2_000,
    }]);
  });

  it('can restore an active intent from a durable store', async () => {
    const stored = new Map<string, unknown>();
    const store = {
      read: (sessionId: string) => stored.get(sessionId) ?? null,
      write: (sessionId: string, intent: unknown) => {
        stored.set(sessionId, intent);
      },
    };
    const first = new UsageLimitRecoveryScheduler({ nowMs: () => 1_000, store });
    await first.enable({
      sessionId: 'session-1',
      issueFingerprint: 'limit',
      resetAtMs: 2_000,
      selectedAuth: { kind: 'native' },
    });

    const second = new UsageLimitRecoveryScheduler({ nowMs: () => 1_500, store });

    expect(second.read('session-1')?.issueFingerprint).toBe('limit');
  });

  it('schedules a previously persisted intent without rewriting its timing', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(1_000));
    const recovered: Array<Readonly<{ issueFingerprint: string; sessionId?: string }>> = [];
    const scheduler = new UsageLimitRecoveryScheduler({
      nowMs: () => Date.now(),
      recover: async (intent, context) => {
        recovered.push({ issueFingerprint: intent.issueFingerprint, sessionId: context.sessionId });
        return { status: 'ready' as const };
      },
    });

    await scheduler.upsert({
      sessionId: 'session-1',
      intent: {
        v: 1,
        status: 'waiting',
        issueFingerprint: 'persisted-limit',
        armedAtMs: 123,
        resetAtMs: 2_000,
        nextCheckAtMs: 2_000,
        attemptCount: 0,
        maxAttempts: 3,
        lastProbeError: null,
        selectedAuth: { kind: 'native' },
      },
    });

    expect(scheduler.read('session-1')).toMatchObject({
      issueFingerprint: 'persisted-limit',
      armedAtMs: 123,
      nextCheckAtMs: 2_000,
    });
    await vi.advanceTimersByTimeAsync(1_000);

    expect(recovered).toEqual([{ issueFingerprint: 'persisted-limit', sessionId: 'session-1' }]);
    vi.useRealTimers();
  });

  it('schedules a timer wake when an intent is enabled', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(1_000));
    const recover = vi.fn(async () => ({ status: 'ready' as const }));
    const resume = vi.fn(async () => {});
    const scheduler = new UsageLimitRecoveryScheduler({
      nowMs: () => Date.now(),
      recover,
      resume,
    });

    await scheduler.enable({
      sessionId: 'session-1',
      issueFingerprint: 'limit',
      resetAtMs: 2_000,
      selectedAuth: { kind: 'native' },
    });

    expect(recover).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(999);
    expect(recover).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(recover).toHaveBeenCalledTimes(1);
    expect(resume).toHaveBeenCalledTimes(1);
    expect(scheduler.read('session-1')?.status).toBe('cancelled');
  });

  it('schedules a timer wake from nextCheckAtMs when resetAtMs is unavailable', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(1_000));
    const recover = vi.fn(async () => ({ status: 'ready' as const }));
    const resume = vi.fn(async () => {});
    const scheduler = new UsageLimitRecoveryScheduler({
      nowMs: () => Date.now(),
      recover,
      resume,
    });

    await scheduler.enable({
      sessionId: 'session-1',
      issueFingerprint: 'limit',
      resetAtMs: null,
      nextCheckAtMs: 2_000,
      selectedAuth: { kind: 'native' },
    });

    expect(scheduler.read('session-1')).toMatchObject({
      resetAtMs: null,
      nextCheckAtMs: 2_000,
    });
    await vi.advanceTimersByTimeAsync(999);
    expect(recover).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(recover).toHaveBeenCalledTimes(1);
    expect(resume).toHaveBeenCalledTimes(1);
    expect(scheduler.read('session-1')?.status).toBe('cancelled');
    vi.useRealTimers();
  });

  it('re-arms the next timer when a probe still needs to wait', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(1_000));
    const recover = vi
      .fn()
      .mockResolvedValueOnce({ status: 'wait' as const, nextCheckAtMs: 3_000 })
      .mockResolvedValueOnce({ status: 'ready' as const });
    const resume = vi.fn(async () => {});
    const scheduler = new UsageLimitRecoveryScheduler({
      nowMs: () => Date.now(),
      recover,
      resume,
    });

    await scheduler.enable({
      sessionId: 'session-1',
      issueFingerprint: 'limit',
      resetAtMs: 2_000,
      selectedAuth: { kind: 'native' },
    });

    await vi.advanceTimersByTimeAsync(1_000);
    expect(recover).toHaveBeenCalledTimes(1);
    expect(scheduler.read('session-1')).toMatchObject({ status: 'waiting', nextCheckAtMs: 3_000 });
    await vi.advanceTimersByTimeAsync(999);
    expect(recover).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);

    expect(recover).toHaveBeenCalledTimes(2);
    expect(resume).toHaveBeenCalledTimes(1);
  });

  it('does not probe before reset time on timer wakes', async () => {
    const recover = vi.fn(async () => ({ status: 'ready' as const }));
    const scheduler = new UsageLimitRecoveryScheduler({
      nowMs: () => 1_500,
      recover,
    });
    await scheduler.enable({
      sessionId: 'session-1',
      issueFingerprint: 'limit',
      resetAtMs: 2_000,
      selectedAuth: { kind: 'native' },
    });

    await expect(scheduler.wake({ sessionId: 'session-1', reason: 'timer' })).resolves.toEqual({
      status: 'waiting',
    });

    expect(recover).not.toHaveBeenCalled();
    expect(scheduler.read('session-1')).toMatchObject({
      status: 'waiting',
      attemptCount: 0,
      nextCheckAtMs: 2_000,
    });
  });

  it('exhausts an intent after its max attempts instead of retrying forever', async () => {
    const recover = vi.fn(async () => ({ status: 'wait' as const, nextCheckAtMs: 2_000 }));
    const scheduler = new UsageLimitRecoveryScheduler({
      nowMs: () => 2_000,
      recover,
    });
    await scheduler.enable({
      sessionId: 'session-1',
      issueFingerprint: 'limit',
      resetAtMs: 1_000,
      maxAttempts: 1,
      selectedAuth: { kind: 'native' },
    });

    await expect(scheduler.wake({ sessionId: 'session-1', reason: 'check_now' })).resolves.toEqual({
      status: 'waiting',
    });
    await expect(scheduler.wake({ sessionId: 'session-1', reason: 'check_now' })).resolves.toEqual({
      status: 'exhausted',
    });

    expect(recover).toHaveBeenCalledTimes(1);
    expect(scheduler.read('session-1')).toMatchObject({
      status: 'exhausted',
      attemptCount: 2,
    });
  });

  it('rate-limits rapid user check-now probes for the same session', async () => {
    let nowMs = 2_000;
    const recover = vi.fn(async () => ({ status: 'wait' as const, nextCheckAtMs: 3_000 }));
    const scheduler = new UsageLimitRecoveryScheduler({
      nowMs: () => nowMs,
      checkNowThrottleMs: 5_000,
      recover,
    });
    await scheduler.enable({
      sessionId: 'session-1',
      issueFingerprint: 'limit',
      resetAtMs: 1_000,
      selectedAuth: { kind: 'native' },
    });

    await expect(scheduler.checkNow({ sessionId: 'session-1' })).resolves.toEqual({
      status: 'waiting',
    });
    await expect(scheduler.checkNow({ sessionId: 'session-1' })).resolves.toEqual({
      status: 'rate_limited',
      errorCode: 'probe_rate_limited',
      retryAfterMs: 5_000,
    });

    nowMs += 5_000;
    await expect(scheduler.checkNow({ sessionId: 'session-1' })).resolves.toEqual({
      status: 'waiting',
    });
    expect(recover).toHaveBeenCalledTimes(2);
  });
});
