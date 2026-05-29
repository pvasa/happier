import { describe, expect, it, vi } from 'vitest';

type TemporaryThrottleModule = Readonly<{
  TemporaryThrottleRecoveryScheduler: new (deps: {
    nowMs: () => number;
    jitterMs?: () => number;
    baseBackoffMs?: number;
    maxBackoffMs?: number;
    store?: {
      read: (sessionId: string) => unknown | null;
      write: (sessionId: string, intent: unknown) => Promise<void> | void;
    };
    retry?: (intent: unknown, context: { sessionId: string }) => Promise<{
      status: 'ready' | 'wait' | 'exhausted';
      retryAfterMs?: number | null;
      lastError?: string | null;
    }>;
    resume?: (intent: unknown) => Promise<void> | void;
  }) => {
    enable: (input: {
      sessionId: string;
      issueFingerprint: string;
      retryAfterMs?: number | null;
      maxAttempts?: number;
    }) => Promise<{ status: string; nextRetryAtMs: number | null; attemptCount: number }>;
    read: (sessionId: string) => { status: string; nextRetryAtMs: number | null; attemptCount: number; issueFingerprint?: string } | null;
    wake: (input: { sessionId: string; reason: 'timer' | 'retry_now' }) => Promise<{ status: string }>;
    retryNow: (input: { sessionId: string }) => Promise<{ status: string }>;
    stopRetrying: (input: { sessionId: string }) => Promise<{ status: string } | null>;
  };
}>;

async function loadTemporaryThrottleModule(): Promise<TemporaryThrottleModule> {
  const modulePath = './TemporaryThrottleRecoveryScheduler';
  const mod = await import(modulePath).catch(() => null);
  expect(mod).not.toBeNull();
  expect(typeof (mod as Partial<TemporaryThrottleModule> | null)?.TemporaryThrottleRecoveryScheduler).toBe('function');
  return mod as TemporaryThrottleModule;
}

describe('TemporaryThrottleRecoveryScheduler', () => {
  it('wakes from its own timer and resumes only after a ready probe', async () => {
    vi.useFakeTimers();
    try {
      const { TemporaryThrottleRecoveryScheduler } = await loadTemporaryThrottleModule();
      let nowMs = 1_000;
      const retry = vi.fn(async () => ({ status: 'ready' as const }));
      const resume = vi.fn();
      const scheduler = new TemporaryThrottleRecoveryScheduler({
        nowMs: () => nowMs,
        retry,
        resume,
      });

      await scheduler.enable({
        sessionId: 'session-1',
        issueFingerprint: 'temporary-throttle:codex:1',
        retryAfterMs: 1_000,
      });

      nowMs = 1_999;
      await vi.advanceTimersByTimeAsync(999);
      expect(retry).not.toHaveBeenCalled();
      expect(resume).not.toHaveBeenCalled();

      nowMs = 2_000;
      await vi.advanceTimersByTimeAsync(1);
      expect(retry).toHaveBeenCalledTimes(1);
      expect(resume).toHaveBeenCalledTimes(1);
      expect(scheduler.read('session-1')?.status).toBe('cancelled');
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses Retry-After before jittered backoff and retries with bounded attempts', async () => {
    const { TemporaryThrottleRecoveryScheduler } = await loadTemporaryThrottleModule();
    let nowMs = 1_000;
    const retry = vi
      .fn()
      .mockResolvedValueOnce({ status: 'wait' as const, retryAfterMs: null })
      .mockResolvedValueOnce({ status: 'ready' as const });
    const resume = vi.fn();
    const scheduler = new TemporaryThrottleRecoveryScheduler({
      nowMs: () => nowMs,
      baseBackoffMs: 1_000,
      maxBackoffMs: 10_000,
      jitterMs: () => 250,
      retry,
      resume,
    });

    await expect(scheduler.enable({
      sessionId: 'session-1',
      issueFingerprint: 'temporary-throttle:codex:1',
      retryAfterMs: 4_000,
      maxAttempts: 2,
    })).resolves.toMatchObject({
      status: 'waiting',
      nextRetryAtMs: 5_000,
      attemptCount: 0,
    });

    nowMs = 5_000;
    await expect(scheduler.wake({ sessionId: 'session-1', reason: 'timer' })).resolves.toEqual({ status: 'waiting' });
    expect(scheduler.read('session-1')).toMatchObject({
      status: 'waiting',
      attemptCount: 1,
      nextRetryAtMs: 7_250,
    });

    nowMs = 7_250;
    await expect(scheduler.wake({ sessionId: 'session-1', reason: 'timer' })).resolves.toEqual({ status: 'resumed' });
    expect(resume).toHaveBeenCalledTimes(1);
  });

  it('supports retry now and stop retrying controls', async () => {
    const { TemporaryThrottleRecoveryScheduler } = await loadTemporaryThrottleModule();
    const retry = vi.fn(async () => ({ status: 'wait' as const, retryAfterMs: 10_000 }));
    const scheduler = new TemporaryThrottleRecoveryScheduler({
      nowMs: () => 1_000,
      retry,
    });

    await scheduler.enable({
      sessionId: 'session-1',
      issueFingerprint: 'temporary-throttle:codex:1',
      retryAfterMs: 60_000,
    });

    await expect(scheduler.retryNow({ sessionId: 'session-1' })).resolves.toEqual({ status: 'waiting' });
    expect(retry).toHaveBeenCalledTimes(1);
    await expect(scheduler.stopRetrying({ sessionId: 'session-1' })).resolves.toEqual({ status: 'cancelled' });
    expect(scheduler.read('session-1')?.status).toBe('cancelled');
  });

  it('reschedules bounded retry when a throttle probe fails', async () => {
    const { TemporaryThrottleRecoveryScheduler } = await loadTemporaryThrottleModule();
    let nowMs = 1_000;
    const retry = vi.fn(async () => {
      throw new Error('provider request timed out');
    });
    const scheduler = new TemporaryThrottleRecoveryScheduler({
      nowMs: () => nowMs,
      baseBackoffMs: 1_000,
      maxBackoffMs: 10_000,
      retry,
    });

    await scheduler.enable({
      sessionId: 'session-1',
      issueFingerprint: 'temporary-throttle:codex:1',
      retryAfterMs: null,
      maxAttempts: 2,
    });

    nowMs = 2_000;
    await expect(scheduler.wake({ sessionId: 'session-1', reason: 'timer' })).resolves.toEqual({ status: 'waiting' });
    expect(scheduler.read('session-1')).toMatchObject({
      status: 'waiting',
      attemptCount: 1,
      nextRetryAtMs: 4_000,
      lastError: 'temporary_throttle_probe_failed',
    });
  });

  it('restores active temporary throttle state from a durable store', async () => {
    const { TemporaryThrottleRecoveryScheduler } = await loadTemporaryThrottleModule();
    const stored = new Map<string, unknown>();
    const store = {
      read: (sessionId: string) => stored.get(sessionId) ?? null,
      write: (sessionId: string, intent: unknown) => {
        stored.set(sessionId, intent);
      },
    };
    const first = new TemporaryThrottleRecoveryScheduler({ nowMs: () => 1_000, store });
    await first.enable({
      sessionId: 'session-1',
      issueFingerprint: 'temporary-throttle:codex:1',
      retryAfterMs: 5_000,
    });

    const second = new TemporaryThrottleRecoveryScheduler({ nowMs: () => 2_000, store });

    expect(second.read('session-1')).toMatchObject({
      status: 'waiting',
      issueFingerprint: 'temporary-throttle:codex:1',
      nextRetryAtMs: 6_000,
    });
  });
});
