import {
  SESSION_USAGE_LIMIT_RECOVERY_METADATA_KEY,
  SESSION_USAGE_LIMIT_RECOVERY_STATE_FIELD_ID,
  SessionUsageLimitRecoveryV1Schema,
  type SessionUsageLimitRecoveryAuthSelectionV1,
  type SessionUsageLimitRecoveryV1,
} from '@happier-dev/protocol';
import {
  UsageLimitCheckNowRateLimiter,
  USAGE_LIMIT_CHECK_NOW_RATE_LIMITED_CODE,
} from '@/session/usageLimitRecoveryControls/usageLimitCheckNowRateLimiter';
import {
  recordConnectedServiceDaemonRestartDiagnostic,
  type ConnectedServiceDaemonRestartDiagnosticRecorder,
} from '../sessionAuthSwitch/requestConnectedServiceSessionRestartSignal';

export const RUNTIME_USAGE_LIMIT_RECOVERY_FIELD = SESSION_USAGE_LIMIT_RECOVERY_STATE_FIELD_ID;
export const METADATA_SESSION_USAGE_LIMIT_RECOVERY_V1_KEY = SESSION_USAGE_LIMIT_RECOVERY_METADATA_KEY;

export type UsageLimitRecoveryIntent = SessionUsageLimitRecoveryV1;

type RecoveryResult =
  | Readonly<{ status: 'ready'; selectedAuth?: SessionUsageLimitRecoveryAuthSelectionV1 }>
  | Readonly<{ status: 'wait'; nextCheckAtMs: number; lastProbeError?: string | null }>
  | Readonly<{ status: 'exhausted'; lastProbeError?: string | null }>;

export type UsageLimitRecoveryIntentStore = Readonly<{
  read(sessionId: string): UsageLimitRecoveryIntent | unknown | null;
  write(sessionId: string, intent: UsageLimitRecoveryIntent): Promise<void> | void;
}>;

type TimerHandle = ReturnType<typeof setTimeout>;

function isUsageLimitRecoveryIntent(value: unknown): value is UsageLimitRecoveryIntent {
  return SessionUsageLimitRecoveryV1Schema.safeParse(value).success;
}

function readUsageLimitRecoveryServiceId(
  selectedAuth: SessionUsageLimitRecoveryAuthSelectionV1,
): string | null {
  return selectedAuth.kind === 'native' ? null : selectedAuth.serviceId;
}

function readUsageLimitRecoveryProfileId(
  selectedAuth: SessionUsageLimitRecoveryAuthSelectionV1,
): string | null {
  return selectedAuth.kind === 'native' ? null : selectedAuth.profileId;
}

function readUsageLimitRecoveryGroupId(
  selectedAuth: SessionUsageLimitRecoveryAuthSelectionV1,
): string | null {
  return selectedAuth.kind === 'group' ? selectedAuth.groupId : null;
}

const DEFAULT_USAGE_LIMIT_RECOVERY_MAX_ATTEMPTS = 3;

export class UsageLimitRecoveryScheduler {
  private readonly intentsBySessionId = new Map<string, UsageLimitRecoveryIntent>();
  private readonly timersBySessionId = new Map<string, TimerHandle>();
  private readonly wakePromisesBySessionId = new Map<string, Promise<Readonly<{ status: string }>>>();
  private readonly checkNowRateLimiter: UsageLimitCheckNowRateLimiter;

  constructor(private readonly deps: Readonly<{
    nowMs: () => number;
    store?: UsageLimitRecoveryIntentStore;
    recover?: (
      intent: UsageLimitRecoveryIntent,
      context: Readonly<{ sessionId: string }>,
    ) => Promise<RecoveryResult>;
    resume?: (intent: UsageLimitRecoveryIntent) => Promise<void>;
    recordRestartDiagnostic?: ConnectedServiceDaemonRestartDiagnosticRecorder;
    checkNowThrottleMs?: number;
  }>) {
    this.checkNowRateLimiter = new UsageLimitCheckNowRateLimiter({
      nowMs: deps.nowMs,
      throttleMs: deps.checkNowThrottleMs,
    });
  }

  read(sessionId: string): UsageLimitRecoveryIntent | null {
    const cached = this.intentsBySessionId.get(sessionId);
    if (cached) return cached;
    const stored = this.deps.store?.read(sessionId) ?? null;
    if (!isUsageLimitRecoveryIntent(stored)) return null;
    this.intentsBySessionId.set(sessionId, stored);
    this.schedule(sessionId, stored);
    return stored;
  }

  private async write(sessionId: string, intent: UsageLimitRecoveryIntent): Promise<void> {
    this.intentsBySessionId.set(sessionId, intent);
    await this.deps.store?.write(sessionId, intent);
    this.schedule(sessionId, intent);
  }

  private clearTimer(sessionId: string): void {
    const timer = this.timersBySessionId.get(sessionId);
    if (!timer) return;
    clearTimeout(timer);
    this.timersBySessionId.delete(sessionId);
  }

  private schedule(sessionId: string, intent: UsageLimitRecoveryIntent): void {
    this.clearTimer(sessionId);
    if (intent.status !== 'waiting') return;
    const targetMs = intent.nextCheckAtMs ?? intent.resetAtMs;
    if (typeof targetMs !== 'number' || !Number.isFinite(targetMs)) return;
    const delayMs = Math.max(0, targetMs - this.deps.nowMs());
    const timer = setTimeout(() => {
      this.timersBySessionId.delete(sessionId);
      void this.wake({ sessionId, reason: 'timer' });
    }, delayMs);
    timer.unref?.();
    this.timersBySessionId.set(sessionId, timer);
  }

  async enable(input: Readonly<{
    sessionId: string;
    issueFingerprint: string;
    resetAtMs: number | null;
    nextCheckAtMs?: number | null;
    maxAttempts?: number;
    selectedAuth: SessionUsageLimitRecoveryAuthSelectionV1;
  }>): Promise<UsageLimitRecoveryIntent> {
    const nowMs = this.deps.nowMs();
    const maxAttempts = typeof input.maxAttempts === 'number' && Number.isFinite(input.maxAttempts)
      ? Math.max(0, Math.trunc(input.maxAttempts))
      : DEFAULT_USAGE_LIMIT_RECOVERY_MAX_ATTEMPTS;
    const intent: UsageLimitRecoveryIntent = {
      v: 1,
      issueFingerprint: input.issueFingerprint,
      status: 'waiting',
      armedAtMs: nowMs,
      resetAtMs: input.resetAtMs,
      nextCheckAtMs: input.nextCheckAtMs ?? input.resetAtMs,
      attemptCount: 0,
      maxAttempts,
      lastProbeError: null,
      selectedAuth: input.selectedAuth,
    };
    await this.write(input.sessionId, intent);
    return intent;
  }

  async upsert(input: Readonly<{
    sessionId: string;
    intent: UsageLimitRecoveryIntent;
  }>): Promise<UsageLimitRecoveryIntent> {
    await this.write(input.sessionId, input.intent);
    return input.intent;
  }

  async cancel(input: Readonly<{ sessionId: string }>): Promise<UsageLimitRecoveryIntent | null> {
    const current = this.read(input.sessionId);
    if (!current) return null;
    const cancelled = { ...current, status: 'cancelled' as const };
    await this.write(input.sessionId, cancelled);
    this.clearTimer(input.sessionId);
    return cancelled;
  }

  async checkNow(input: Readonly<{ sessionId: string }>): Promise<Readonly<{
    status: string;
    errorCode?: string;
    retryAfterMs?: number;
  }>> {
    const rateLimit = this.checkNowRateLimiter.check(input.sessionId);
    if (!rateLimit.allowed) {
      return {
        status: 'rate_limited',
        errorCode: USAGE_LIMIT_CHECK_NOW_RATE_LIMITED_CODE,
        retryAfterMs: rateLimit.retryAfterMs,
      };
    }
    return await this.wake({ sessionId: input.sessionId, reason: 'check_now' });
  }

  async wake(input: Readonly<{ sessionId: string; reason: 'timer' | 'check_now' }>): Promise<Readonly<{ status: string }>> {
    const currentWake = this.wakePromisesBySessionId.get(input.sessionId);
    if (currentWake) return await currentWake;
    const wakePromise = this.performWake(input);
    this.wakePromisesBySessionId.set(input.sessionId, wakePromise);
    try {
      return await wakePromise;
    } finally {
      if (this.wakePromisesBySessionId.get(input.sessionId) === wakePromise) {
        this.wakePromisesBySessionId.delete(input.sessionId);
      }
    }
  }

  private async performWake(input: Readonly<{ sessionId: string; reason: 'timer' | 'check_now' }>): Promise<Readonly<{ status: string }>> {
    const current = this.read(input.sessionId);
    if (!current || current.status === 'cancelled') {
      return { status: 'inactive' };
    }

    const nowMs = this.deps.nowMs();
    const nextCheckAtMs = current.nextCheckAtMs ?? current.resetAtMs;
    if (input.reason === 'timer' && nextCheckAtMs !== null && nowMs < nextCheckAtMs) {
      return { status: 'waiting' };
    }

    const nextAttemptCount = current.attemptCount + 1;
    if (current.maxAttempts > 0 && current.attemptCount >= current.maxAttempts) {
      await this.write(input.sessionId, {
        ...current,
        status: 'exhausted',
        attemptCount: nextAttemptCount,
        lastProbeError: current.lastProbeError ?? 'usage_limit_recovery_max_attempts_exhausted',
      });
      this.clearTimer(input.sessionId);
      return { status: 'exhausted' };
    }

    const checking: UsageLimitRecoveryIntent = {
      ...current,
      status: 'checking',
      attemptCount: nextAttemptCount,
    };
    await this.write(input.sessionId, checking);

    const recovery = this.deps.recover
      ? await this.deps.recover(checking, { sessionId: input.sessionId })
      : { status: 'wait' as const, nextCheckAtMs: checking.nextCheckAtMs ?? checking.resetAtMs ?? nowMs };

    if (recovery.status === 'ready') {
      const succeeded: UsageLimitRecoveryIntent = {
        ...checking,
        status: 'cancelled',
        selectedAuth: recovery.selectedAuth ?? checking.selectedAuth,
      };
      await this.write(input.sessionId, succeeded);
      this.clearTimer(input.sessionId);
      recordConnectedServiceDaemonRestartDiagnostic({
        diagnostic: {
          trigger: 'usage_limit_recovery',
          sessionId: input.sessionId,
          serviceId: readUsageLimitRecoveryServiceId(succeeded.selectedAuth),
          profileId: readUsageLimitRecoveryProfileId(succeeded.selectedAuth),
          groupId: readUsageLimitRecoveryGroupId(succeeded.selectedAuth),
          reason: succeeded.issueFingerprint,
        },
        status: 'requested',
        nowMs: this.deps.nowMs,
        recordRestartDiagnostic: this.deps.recordRestartDiagnostic,
      });
      await this.deps.resume?.(succeeded);
      return { status: 'resumed' };
    }

    if (recovery.status === 'exhausted') {
      await this.write(input.sessionId, {
        ...checking,
        status: 'exhausted',
        lastProbeError: recovery.lastProbeError ?? null,
      });
      this.clearTimer(input.sessionId);
      return { status: 'exhausted' };
    }

    await this.write(input.sessionId, {
      ...checking,
      status: 'waiting',
      nextCheckAtMs: recovery.nextCheckAtMs,
      lastProbeError: recovery.lastProbeError ?? null,
    });
    return { status: 'waiting' };
  }
}
