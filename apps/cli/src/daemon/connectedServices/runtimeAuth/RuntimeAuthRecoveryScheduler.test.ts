import { describe, expect, it, vi } from 'vitest';

import {
  RuntimeAuthRecoveryScheduler,
  type RuntimeAuthRecoveryDiagnostic,
  type RuntimeAuthRecoveryIntent,
} from './RuntimeAuthRecoveryScheduler';
import { buildRuntimeAuthRecoveryKey } from './recoveryKey/runtimeAuthRecoveryKey';
import type { ConnectedServiceRuntimeFailureClassification } from './types';

function classification(): ConnectedServiceRuntimeFailureClassification {
  return {
    kind: 'usage_limit',
    serviceId: 'openai-codex',
    profileId: 'primary',
    groupId: 'team',
    resetsAtMs: null,
    planType: null,
    rateLimits: null,
    source: 'structured_provider_error',
  } as ConnectedServiceRuntimeFailureClassification;
}

function classificationFor(
  patch: Partial<ConnectedServiceRuntimeFailureClassification>,
): ConnectedServiceRuntimeFailureClassification {
  return {
    ...classification(),
    ...patch,
  } as ConnectedServiceRuntimeFailureClassification;
}

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

describe('RuntimeAuthRecoveryScheduler', () => {
  it('keeps separate runtime-auth recovery intents for two services in one session', async () => {
    const scheduler = new RuntimeAuthRecoveryScheduler({
      nowMs: () => 1_000,
      baseBackoffMs: 100,
      maxBackoffMs: 1_000,
      jitterMs: () => 0,
      recover: async () => ({ status: 'credential_refreshed' }),
    });
    const codex = classificationFor({
      serviceId: 'openai-codex',
      profileId: 'primary',
      groupId: 'codex-group',
    });
    const anthropic = classificationFor({
      serviceId: 'anthropic',
      profileId: 'backup',
      groupId: 'anthropic-group',
    });

    await scheduler.enqueueHandlerFailure({
      sessionId: 'session-1',
      switchesThisTurn: 0,
      classification: codex,
      error: new Error('timeout of 5000ms exceeded'),
    });
    await scheduler.enqueueHandlerFailure({
      sessionId: 'session-1',
      switchesThisTurn: 0,
      classification: anthropic,
      error: new Error('timeout of 5000ms exceeded'),
    });

    expect(scheduler.readByKey(buildRuntimeAuthRecoveryKey({
      sessionId: 'session-1',
      serviceId: 'openai-codex',
      profileId: 'primary',
      groupId: 'codex-group',
    }))).toMatchObject({
      sessionId: 'session-1',
      serviceId: 'openai-codex',
      profileId: 'primary',
      groupId: 'codex-group',
    });
    expect(scheduler.readByKey(buildRuntimeAuthRecoveryKey({
      sessionId: 'session-1',
      serviceId: 'anthropic',
      profileId: 'backup',
      groupId: 'anthropic-group',
    }))).toMatchObject({
      sessionId: 'session-1',
      serviceId: 'anthropic',
      profileId: 'backup',
      groupId: 'anthropic-group',
    });
    expect(scheduler.readForSession('session-1').map((intent) => intent.serviceId).sort()).toEqual([
      'anthropic',
      'openai-codex',
    ]);
  });

  it('marks one composite recovery key succeeded without clobbering sibling intents', async () => {
    const diagnostics: RuntimeAuthRecoveryDiagnostic[] = [];
    const scheduler = new RuntimeAuthRecoveryScheduler({
      nowMs: () => 1_000,
      baseBackoffMs: 100,
      maxBackoffMs: 1_000,
      jitterMs: () => 0,
      recover: async () => ({ status: 'credential_refreshed' }),
      recordDiagnostic: (event) => {
        diagnostics.push(event);
      },
    });
    const codex = classificationFor({
      serviceId: 'openai-codex',
      profileId: 'primary',
      groupId: 'codex-group',
    });
    const anthropic = classificationFor({
      serviceId: 'anthropic',
      profileId: 'backup',
      groupId: 'anthropic-group',
    });
    const codexKey = buildRuntimeAuthRecoveryKey({
      sessionId: 'session-1',
      serviceId: 'openai-codex',
      profileId: 'primary',
      groupId: 'codex-group',
    });
    const anthropicKey = buildRuntimeAuthRecoveryKey({
      sessionId: 'session-1',
      serviceId: 'anthropic',
      profileId: 'backup',
      groupId: 'anthropic-group',
    });

    await scheduler.enqueueHandlerFailure({
      sessionId: 'session-1',
      switchesThisTurn: 0,
      classification: codex,
      error: new Error('timeout of 5000ms exceeded'),
    });
    await scheduler.enqueueHandlerFailure({
      sessionId: 'session-1',
      switchesThisTurn: 0,
      classification: anthropic,
      error: new Error('timeout of 5000ms exceeded'),
    });

    await scheduler.markSucceededByKey(codexKey);

    expect(scheduler.readByKey(codexKey)).toBeNull();
    expect(scheduler.readByKey(anthropicKey)).toMatchObject({
      status: 'waiting',
      serviceId: 'anthropic',
      profileId: 'backup',
      groupId: 'anthropic-group',
    });
    expect(diagnostics).toContainEqual(expect.objectContaining({
      event: 'runtime_auth_recovery_success',
      sessionId: 'session-1',
      serviceId: 'openai-codex',
      profileId: 'primary',
      groupId: 'codex-group',
    }));
  });

  it('records scheduled recovery diagnostics with typed runtime-auth recovery transcript events', async () => {
    const diagnostics: RuntimeAuthRecoveryDiagnostic[] = [];
    const scheduler = new RuntimeAuthRecoveryScheduler({
      nowMs: () => 1_000,
      baseBackoffMs: 100,
      maxBackoffMs: 1_000,
      jitterMs: () => 0,
      recover: async () => ({ status: 'credential_refreshed' }),
      recordDiagnostic: (event) => {
        diagnostics.push(event);
      },
    });

    await scheduler.enqueueHandlerFailure({
      sessionId: 'session-1',
      switchesThisTurn: 0,
      classification: classification(),
      error: new Error('timeout of 5000ms exceeded'),
    });

    const scheduled = diagnostics.find((event) => event.event === 'runtime_auth_recovery_enqueue');
    expect(scheduled?.transcriptEvent).toMatchObject({
      type: 'connected-service-runtime-auth-recovery',
      status: 'retry_scheduled',
      serviceId: 'openai-codex',
      profileId: 'primary',
      groupId: 'team',
      nextRetryAtMs: 1_100,
      terminal: false,
      diagnostic: {
        code: 'recovery_retry_scheduled',
        source: 'runtime_auth_recovery',
        failurePhase: 'runtime_auth_recovery',
      },
    });
  });

  it('records dead-letter diagnostics with typed runtime-auth recovery transcript events', async () => {
    const diagnostics: RuntimeAuthRecoveryDiagnostic[] = [];
    const scheduler = new RuntimeAuthRecoveryScheduler({
      nowMs: () => 1_000,
      baseBackoffMs: 100,
      maxBackoffMs: 1_000,
      jitterMs: () => 0,
      maxAttempts: 1,
      recover: async () => ({
        status: 'generation_apply_failed',
        errorCode: 'hot_apply_failed',
        diagnostics: {
          underlyingError: 'timeout of 5000ms exceeded',
        },
      }),
      recordDiagnostic: (event) => {
        diagnostics.push(event);
      },
    });

    await scheduler.enqueueHandlerFailure({
      sessionId: 'session-1',
      switchesThisTurn: 0,
      classification: classification(),
      error: new Error('timeout of 5000ms exceeded'),
    });
    await scheduler.wake({ sessionId: 'session-1', reason: 'manual' });

    const deadLetter = diagnostics.find((event) => event.event === 'runtime_auth_recovery_dead_letter');
    expect(deadLetter?.transcriptEvent).toMatchObject({
      type: 'connected-service-runtime-auth-recovery',
      status: 'dead_lettered',
      serviceId: 'openai-codex',
      profileId: 'primary',
      groupId: 'team',
      terminal: true,
      diagnostic: {
        code: 'recovery_dead_lettered',
        source: 'runtime_auth_recovery',
        failurePhase: 'runtime_auth_recovery',
      },
    });
  });

  it('backs off retryable apply failures instead of persisting checking intents as immediately due', async () => {
    vi.useFakeTimers();
    try {
      let now = 1_000;
      const retryableApplyFailure = {
        status: 'generation_apply_failed',
        errorCode: 'hot_apply_failed',
        diagnostics: {
          underlyingError: 'timeout of 5000ms exceeded',
        },
      };
      const scheduler = new RuntimeAuthRecoveryScheduler({
        nowMs: () => now,
        baseBackoffMs: 100,
        maxBackoffMs: 1_000,
        jitterMs: () => 0,
        recover: async () => retryableApplyFailure,
      });

      await scheduler.enqueueApplyFailure({
        sessionId: 'session-1',
        switchesThisTurn: 1,
        classification: classification(),
        result: retryableApplyFailure,
      });

      await expect(scheduler.wake({ sessionId: 'session-1', reason: 'manual' }))
        .resolves.toEqual({ status: 'waiting' });

      const intent = scheduler.read('session-1');
      expect(intent).toMatchObject({
        status: 'waiting',
        attemptCount: 1,
        failurePhase: 'apply',
        lastErrorClassification: { kind: 'timeout', retryable: true },
      } satisfies Partial<RuntimeAuthRecoveryIntent>);
      expect(intent?.nextRetryAtMs).toBe(now + 200);
    } finally {
      vi.useRealTimers();
    }
  });

  it('backs off retryable handler failures instead of persisting checking intents as immediately due', async () => {
    vi.useFakeTimers();
    try {
      let now = 2_000;
      const scheduler = new RuntimeAuthRecoveryScheduler({
        nowMs: () => now,
        baseBackoffMs: 100,
        maxBackoffMs: 1_000,
        jitterMs: () => 0,
        recover: async () => {
          throw new Error('timeout of 5000ms exceeded');
        },
      });

      await scheduler.enqueueHandlerFailure({
        sessionId: 'session-1',
        switchesThisTurn: 1,
        classification: classification(),
        error: new Error('timeout of 5000ms exceeded'),
      });

      await expect(scheduler.wake({ sessionId: 'session-1', reason: 'manual' }))
        .resolves.toEqual({ status: 'waiting' });

      const intent = scheduler.read('session-1');
      expect(intent).toMatchObject({
        status: 'waiting',
        attemptCount: 1,
        failurePhase: 'handler',
        lastErrorClassification: { kind: 'timeout', retryable: true },
      } satisfies Partial<RuntimeAuthRecoveryIntent>);
      expect(intent?.nextRetryAtMs).toBe(now + 200);
    } finally {
      vi.useRealTimers();
    }
  });

  it('preserves attempt state when the same runtime-auth failure is reported again', async () => {
    let now = 2_000;
    const scheduler = new RuntimeAuthRecoveryScheduler({
      nowMs: () => now,
      baseBackoffMs: 100,
      maxBackoffMs: 1_000,
      jitterMs: () => 0,
      maxAttempts: 3,
      recover: async () => {
        throw new Error('timeout of 5000ms exceeded');
      },
    });

    await scheduler.enqueueHandlerFailure({
      sessionId: 'session-1',
      switchesThisTurn: 1,
      classification: classification(),
      error: new Error('timeout of 5000ms exceeded'),
    });
    await expect(scheduler.wake({ sessionId: 'session-1', reason: 'manual' }))
      .resolves.toEqual({ status: 'waiting' });
    expect(scheduler.read('session-1')).toMatchObject({
      status: 'waiting',
      attemptCount: 1,
      nextRetryAtMs: 2_200,
    } satisfies Partial<RuntimeAuthRecoveryIntent>);

    now = 2_050;
    await scheduler.enqueueHandlerFailure({
      sessionId: 'session-1',
      switchesThisTurn: 2,
      classification: classification(),
      error: Object.assign(new Error('socket reset'), { code: 'ECONNRESET' }),
    });

    expect(scheduler.read('session-1')).toMatchObject({
      status: 'waiting',
      attemptCount: 1,
      nextRetryAtMs: 2_150,
      switchesThisTurn: 2,
      lastErrorClassification: { kind: 'network', retryable: true },
    } satisfies Partial<RuntimeAuthRecoveryIntent>);
  });

  it('does not revive an exhausted runtime-auth recovery intent when the provider reports the same failure again', async () => {
    let now = 3_000;
    const diagnostics: RuntimeAuthRecoveryDiagnostic[] = [];
    const scheduler = new RuntimeAuthRecoveryScheduler({
      nowMs: () => now,
      baseBackoffMs: 100,
      maxBackoffMs: 1_000,
      jitterMs: () => 0,
      maxAttempts: 1,
      recover: async () => {
        throw new Error('timeout of 5000ms exceeded');
      },
      recordDiagnostic: (event) => {
        diagnostics.push(event);
      },
    });

    await scheduler.enqueueHandlerFailure({
      sessionId: 'session-1',
      switchesThisTurn: 1,
      classification: classification(),
      error: new Error('timeout of 5000ms exceeded'),
    });
    await expect(scheduler.wake({ sessionId: 'session-1', reason: 'manual' }))
      .resolves.toEqual({ status: 'exhausted' });
    expect(scheduler.read('session-1')).toMatchObject({
      status: 'exhausted',
      attemptCount: 1,
      maxAttempts: 1,
    } satisfies Partial<RuntimeAuthRecoveryIntent>);

    now = 3_050;
    await expect(scheduler.enqueueHandlerFailure({
      sessionId: 'session-1',
      switchesThisTurn: 2,
      classification: classification(),
      error: new Error('timeout of 5000ms exceeded'),
    })).resolves.toMatchObject({
      status: 'exhausted',
      retryable: false,
    });

    expect(scheduler.read('session-1')).toMatchObject({
      status: 'exhausted',
      attemptCount: 1,
      maxAttempts: 1,
      nextRetryAtMs: null,
    } satisfies Partial<RuntimeAuthRecoveryIntent>);
    expect(diagnostics.filter((event) => event.event === 'runtime_auth_recovery_dead_letter')).toHaveLength(1);
  });

  it('prunes stale terminal durable intents when scheduling new runtime-auth recovery', async () => {
    const nowMs = 8 * 24 * 60 * 60_000;
    const oldKey = buildRuntimeAuthRecoveryKey({
      sessionId: 'session-old',
      serviceId: 'openai-codex',
      profileId: 'primary',
      groupId: 'team',
    });
    const freshKey = buildRuntimeAuthRecoveryKey({
      sessionId: 'session-fresh',
      serviceId: 'openai-codex',
      profileId: 'primary',
      groupId: 'team',
    });
    const stored = new Map<string, RuntimeAuthRecoveryIntent>([
      [oldKey, {
        v: 1,
        sessionId: 'session-old',
        serviceId: 'openai-codex',
        profileId: 'primary',
        groupId: 'team',
        status: 'cancelled',
        armedAtMs: 1_000,
        nextRetryAtMs: null,
        attemptCount: 1,
        maxAttempts: 3,
        switchesThisTurn: 1,
        classification: classification(),
        failurePhase: 'handler',
        failureReason: 'handler_transient_failure',
        lastError: null,
        lastErrorClassification: null,
        terminalAtMs: 1_000,
      }],
      [freshKey, {
        v: 1,
        sessionId: 'session-fresh',
        serviceId: 'openai-codex',
        profileId: 'primary',
        groupId: 'team',
        status: 'exhausted',
        armedAtMs: nowMs - 2_000,
        nextRetryAtMs: null,
        attemptCount: 3,
        maxAttempts: 3,
        switchesThisTurn: 1,
        classification: classification(),
        failurePhase: 'handler',
        failureReason: 'handler_transient_failure',
        lastError: 'max_attempts_exhausted',
        lastErrorClassification: null,
        terminalAtMs: nowMs - 1_000,
      }],
    ]);
    const pruned: string[] = [];
    const store = {
      read: (key: string) => stored.get(key) ?? null,
      readAll: () => [...stored.entries()],
      write: (key: string, intent: RuntimeAuthRecoveryIntent) => {
        stored.set(key, intent);
      },
      prune: (predicate: (entry: Readonly<{ recoveryKey: string; value: unknown }>) => boolean) => {
        const removed: string[] = [];
        for (const [recoveryKey, value] of stored.entries()) {
          if (!predicate({ recoveryKey, value })) continue;
          stored.delete(recoveryKey);
          removed.push(recoveryKey);
        }
        pruned.push(...removed);
        return removed;
      },
    };
    const scheduler = new RuntimeAuthRecoveryScheduler({
      nowMs: () => nowMs,
      baseBackoffMs: 100,
      maxBackoffMs: 1_000,
      jitterMs: () => 0,
      store,
      recover: async () => ({ status: 'credential_refreshed' }),
    });

    await scheduler.enqueueHandlerFailure({
      sessionId: 'session-new',
      switchesThisTurn: 1,
      classification: classification(),
      error: new Error('timeout of 5000ms exceeded'),
    });

    expect(pruned).toEqual([oldKey]);
    expect(stored.has(oldKey)).toBe(false);
    expect(stored.has(freshKey)).toBe(true);
    expect(scheduler.read('session-new')).toMatchObject({ status: 'waiting' });
  });

  it('coalesces duplicate reports while a same-key recovery check is in flight', async () => {
    const recoverStarted = createDeferred<void>();
    const recoverOutcome = createDeferred<unknown>();
    const recover = vi.fn(async () => {
      recoverStarted.resolve();
      return await recoverOutcome.promise;
    });
    const scheduler = new RuntimeAuthRecoveryScheduler({
      nowMs: () => 4_000,
      baseBackoffMs: 100,
      maxBackoffMs: 1_000,
      jitterMs: () => 0,
      maxAttempts: 3,
      recover,
    });

    await scheduler.enqueueHandlerFailure({
      sessionId: 'session-1',
      switchesThisTurn: 1,
      classification: classification(),
      error: new Error('timeout of 5000ms exceeded'),
    });
    const wakePromise = scheduler.wake({ sessionId: 'session-1', reason: 'manual' });
    await recoverStarted.promise;

    await scheduler.enqueueHandlerFailure({
      sessionId: 'session-1',
      switchesThisTurn: 2,
      classification: classification(),
      error: Object.assign(new Error('socket reset'), { code: 'ECONNRESET' }),
    });

    expect(recover).toHaveBeenCalledTimes(1);
    expect(scheduler.read('session-1')).toMatchObject({
      status: 'checking',
      attemptCount: 1,
      switchesThisTurn: 2,
      lastErrorClassification: { kind: 'network', retryable: true },
    } satisfies Partial<RuntimeAuthRecoveryIntent>);

    recoverOutcome.resolve({
      status: 'generation_apply_failed',
      errorCode: 'hot_apply_failed',
      diagnostics: {
        underlyingError: 'timeout of 5000ms exceeded',
      },
    });
    await expect(wakePromise).resolves.toEqual({ status: 'waiting' });
    expect(recover).toHaveBeenCalledTimes(1);
    expect(scheduler.read('session-1')).toMatchObject({
      status: 'waiting',
      attemptCount: 1,
      switchesThisTurn: 2,
      failurePhase: 'handler',
      failureReason: 'handler_transient_failure',
      lastError: 'socket reset',
      lastErrorClassification: { kind: 'network', retryable: true },
    } satisfies Partial<RuntimeAuthRecoveryIntent>);
  });

  it('keeps the stricter max-attempt cap when the same recovery key is re-enqueued', async () => {
    const written = new Map<string, RuntimeAuthRecoveryIntent>();
    const store = {
      read: (key: string) => written.get(key) ?? null,
      write: (key: string, intent: RuntimeAuthRecoveryIntent) => {
        written.set(key, intent);
      },
    };
    const firstScheduler = new RuntimeAuthRecoveryScheduler({
      nowMs: () => 5_000,
      baseBackoffMs: 100,
      maxBackoffMs: 1_000,
      jitterMs: () => 0,
      maxAttempts: 2,
      store,
      recover: async () => ({ status: 'credential_refreshed' }),
    });
    await firstScheduler.enqueueHandlerFailure({
      sessionId: 'session-1',
      switchesThisTurn: 1,
      classification: classification(),
      error: new Error('timeout of 5000ms exceeded'),
    });

    const secondScheduler = new RuntimeAuthRecoveryScheduler({
      nowMs: () => 5_050,
      baseBackoffMs: 100,
      maxBackoffMs: 1_000,
      jitterMs: () => 0,
      maxAttempts: 5,
      store,
      recover: async () => ({ status: 'credential_refreshed' }),
    });
    await secondScheduler.enqueueHandlerFailure({
      sessionId: 'session-1',
      switchesThisTurn: 2,
      classification: classification(),
      error: new Error('timeout of 5000ms exceeded'),
    });

    expect(secondScheduler.read('session-1')).toMatchObject({
      maxAttempts: 2,
      switchesThisTurn: 2,
    } satisfies Partial<RuntimeAuthRecoveryIntent>);
  });

  it('routes thrown generation apply failures through apply-failure retry classification', async () => {
    const scheduler = new RuntimeAuthRecoveryScheduler({
      nowMs: () => 3_000,
      baseBackoffMs: 100,
      maxBackoffMs: 1_000,
      jitterMs: () => 0,
      recover: async () => ({ status: 'credential_refreshed' }),
    });
    const error = new Error('connected_service_auth_generation_apply_failed:post_switch_verification_failed');
    Object.assign(error, {
      connectedServiceAuthGenerationApplyFailure: {
        diagnostics: {
          retryable: true,
          verification: {
            reason: 'active_account_probe_missing_account_id',
          },
        },
      },
    });

    await expect(scheduler.enqueueHandlerFailure({
      sessionId: 'session-1',
      switchesThisTurn: 1,
      classification: classification(),
      error,
    })).resolves.toEqual({
      status: 'scheduled',
      retryable: true,
      nextRetryAtMs: 3_100,
    });

    expect(scheduler.read('session-1')).toMatchObject({
      status: 'waiting',
      failurePhase: 'apply',
      failureReason: 'post_switch_verification_failed',
      lastError: 'active_account_probe_missing_account_id',
      lastErrorClassification: { kind: 'protocol_error', retryable: true },
    } satisfies Partial<RuntimeAuthRecoveryIntent>);
  });

  it('backs off stale-process restart failures during recovery instead of cancelling the intent', async () => {
    const scheduler = new RuntimeAuthRecoveryScheduler({
      nowMs: () => 4_000,
      baseBackoffMs: 100,
      maxBackoffMs: 1_000,
      jitterMs: () => 0,
      recover: async () => ({
        status: 'switch_attempted',
        result: {
          status: 'generation_apply_failed',
          errorCode: 'restart_failed',
          diagnostics: {
            failurePhase: 'restart',
            retryable: true,
            underlyingError: 'Error: kill ESRCH',
          },
        },
      }),
    });

    await scheduler.enqueueApplyFailure({
      sessionId: 'session-1',
      switchesThisTurn: 1,
      classification: classification(),
      result: {
        status: 'generation_apply_failed',
        errorCode: 'provider_account_adoption_mismatch',
        diagnostics: {
          retryable: true,
          verification: { reason: 'provider_account_adoption_mismatch' },
        },
      },
    });

    await expect(scheduler.wake({ sessionId: 'session-1', reason: 'manual' }))
      .resolves.toEqual({ status: 'waiting' });

    expect(scheduler.read('session-1')).toMatchObject({
      status: 'waiting',
      attemptCount: 1,
      failurePhase: 'apply',
      lastError: 'restart_failed',
      lastErrorClassification: { kind: 'protocol_error', retryable: true },
    } satisfies Partial<RuntimeAuthRecoveryIntent>);
  });

  it('treats credential_refreshed recovery results as success and clears the recovery intent', async () => {
    const diagnostics: string[] = [];
    const scheduler = new RuntimeAuthRecoveryScheduler({
      nowMs: () => 1_000,
      baseBackoffMs: 100,
      maxBackoffMs: 1_000,
      jitterMs: () => 0,
      recover: async () => ({ status: 'credential_refreshed', restartRequested: true }),
      recordDiagnostic: (event) => {
        diagnostics.push(event.event);
      },
    });

    await scheduler.enqueueApplyFailure({
      sessionId: 'session-1',
      switchesThisTurn: 1,
      classification: classification(),
      result: {
        status: 'generation_apply_failed',
        errorCode: 'hot_apply_failed',
        diagnostics: {
          underlyingError: 'timeout of 5000ms exceeded',
        },
      },
    });

    await expect(scheduler.wake({ sessionId: 'session-1', reason: 'manual' }))
      .resolves.toEqual({ status: 'succeeded' });

    expect(scheduler.read('session-1')).toBeNull();
    expect(diagnostics).toContain('runtime_auth_recovery_success');
    expect(diagnostics).not.toContain('runtime_auth_recovery_terminal');
  });

  it('treats successful switch owner results as success and clears the recovery intent', async () => {
    const diagnostics: string[] = [];
    const scheduler = new RuntimeAuthRecoveryScheduler({
      nowMs: () => 1_000,
      baseBackoffMs: 100,
      maxBackoffMs: 1_000,
      jitterMs: () => 0,
      recover: async () => ({
        status: 'switch_attempted',
        result: {
          ok: true,
          action: 'restart_requested',
        },
      }),
      recordDiagnostic: (event) => {
        diagnostics.push(event.event);
      },
    });

    await scheduler.enqueueHandlerFailure({
      sessionId: 'session-1',
      switchesThisTurn: 1,
      classification: classification(),
      error: new Error('timeout of 5000ms exceeded'),
    });

    await expect(scheduler.wake({ sessionId: 'session-1', reason: 'manual' }))
      .resolves.toEqual({ status: 'succeeded' });

    expect(scheduler.read('session-1')).toBeNull();
    expect(diagnostics).toContain('runtime_auth_recovery_success');
    expect(diagnostics).not.toContain('runtime_auth_recovery_terminal');
  });

  it('schedules a fresh same-key recovery after a previous recovery succeeds', async () => {
    const scheduler = new RuntimeAuthRecoveryScheduler({
      nowMs: () => 1_000,
      baseBackoffMs: 100,
      maxBackoffMs: 1_000,
      jitterMs: () => 0,
      recover: async () => ({
        status: 'switch_attempted',
        result: {
          ok: true,
          action: 'restart_requested',
        },
      }),
    });

    await scheduler.enqueueHandlerFailure({
      sessionId: 'session-1',
      switchesThisTurn: 1,
      classification: classification(),
      error: new Error('timeout of 5000ms exceeded'),
    });

    await expect(scheduler.wake({ sessionId: 'session-1', reason: 'manual' }))
      .resolves.toEqual({ status: 'succeeded' });

    await expect(scheduler.enqueueHandlerFailure({
      sessionId: 'session-1',
      switchesThisTurn: 1,
      classification: classification(),
      error: new Error('timeout of 5000ms exceeded'),
    })).resolves.toMatchObject({
      status: 'scheduled',
      retryable: true,
    });
    expect(scheduler.read('session-1')).toMatchObject({
      status: 'waiting',
      attemptCount: 0,
    });
  });

  it('sanitizes provider handler error messages before persisting recovery diagnostics', async () => {
    const scheduler = new RuntimeAuthRecoveryScheduler({
      nowMs: () => 1_000,
      baseBackoffMs: 100,
      maxBackoffMs: 1_000,
      jitterMs: () => 0,
      recover: async () => ({ status: 'credential_refreshed' }),
    });

    await scheduler.enqueueHandlerFailure({
      sessionId: 'session-1',
      switchesThisTurn: 1,
      classification: classification(),
      error: new Error('timeout Bearer raw-secret-token refreshToken=raw-refresh-token'),
    });

    const intent = scheduler.read('session-1');
    expect(intent?.lastError).not.toContain('raw-secret-token');
    expect(intent?.lastError).not.toContain('raw-refresh-token');
    expect(intent?.lastError).toContain('[REDACTED]');
  });
});
