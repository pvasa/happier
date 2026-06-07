import { TERMINAL_INPUT_QUIET_PERIOD_MS } from '@/agent/runtime/terminal/injection/arbiter';
import type { TerminalHostAdapter, TerminalHostHandle } from '@/integrations/terminalHost/_types';

import type { ClaudeUnifiedInputArbiter, ClaudeUnifiedStartableDisposable } from './_types';

const DEFAULT_STARTUP_READINESS_POLL_MS = 250;
const DEFAULT_STARTUP_READINESS_TIMEOUT_MS = 15_000;

export class ClaudeUnifiedTerminalReadinessTimeoutError extends Error {
  readonly code = 'claude_unified_terminal_readiness_timeout';
  readonly timeoutMs: number;
  readonly handle: TerminalHostHandle;

  constructor(params: Readonly<{ timeoutMs: number; handle: TerminalHostHandle }>) {
    super('Claude unified terminal did not become ready before startup timeout');
    this.name = 'ClaudeUnifiedTerminalReadinessTimeoutError';
    this.timeoutMs = params.timeoutMs;
    this.handle = params.handle;
  }
}

function wait(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

export function createClaudeUnifiedTerminalReadinessBridge(opts: Readonly<{
  hostAdapter: Pick<TerminalHostAdapter, 'captureInputState' | 'evaluateLiveness'>;
  handle: TerminalHostHandle;
  arbiter: Pick<ClaudeUnifiedInputArbiter, 'observeLifecycle' | 'observeUserTypingState' | 'drainWhenSafe'>;
  pollIntervalMs?: number | undefined;
  quietPeriodMs?: number | undefined;
  timeoutMs?: number | undefined;
  emitOutputReadiness?: boolean | undefined;
  nowMs?: (() => number) | undefined;
  onStartupReady?: (() => void) | undefined;
}>): ClaudeUnifiedStartableDisposable {
  const pollIntervalMs = Math.max(1, Math.trunc(opts.pollIntervalMs ?? DEFAULT_STARTUP_READINESS_POLL_MS));
  const quietPeriodMs = Math.max(0, Math.trunc(opts.quietPeriodMs ?? TERMINAL_INPUT_QUIET_PERIOD_MS));
  const timeoutMs = Math.max(1, Math.trunc(opts.timeoutMs ?? DEFAULT_STARTUP_READINESS_TIMEOUT_MS));
  const emitOutputReadiness = opts.emitOutputReadiness ?? true;
  const nowMs = opts.nowMs ?? Date.now;

  let disposed = false;
  let started = false;
  let quietDrainTimer: ReturnType<typeof setTimeout> | null = null;

  const clearQuietDrainTimer = (): void => {
    if (!quietDrainTimer) return;
    clearTimeout(quietDrainTimer);
    quietDrainTimer = null;
  };

  const scheduleQuietDrain = (): void => {
    clearQuietDrainTimer();
    quietDrainTimer = setTimeout(() => {
      void opts.arbiter.drainWhenSafe().catch(() => undefined);
    }, quietPeriodMs);
    quietDrainTimer.unref?.();
  };

  const observeReady = async (observedAtMs: number): Promise<void> => {
    opts.onStartupReady?.();
    if (!emitOutputReadiness) return;
    opts.arbiter.observeLifecycle({ type: 'output', observedAtMs });
    await opts.arbiter.drainWhenSafe();
    scheduleQuietDrain();
  };

  const pollUntilReady = async (abortSignal: AbortSignal): Promise<void> => {
    const startedAtMs = nowMs();
    const waitForNextPoll = async (): Promise<'continue' | 'stopped' | 'timeout'> => {
      if (disposed || abortSignal.aborted) return 'stopped';
      if (nowMs() - startedAtMs >= timeoutMs) {
        return 'timeout';
      }
      await wait(pollIntervalMs);
      if (disposed || abortSignal.aborted) return 'stopped';
      return nowMs() - startedAtMs >= timeoutMs ? 'timeout' : 'continue';
    };
    const continueAfterDelay = async (): Promise<boolean> => {
      const next = await waitForNextPoll();
      if (next === 'timeout') {
        throw new ClaudeUnifiedTerminalReadinessTimeoutError({
          timeoutMs,
          handle: opts.handle,
        });
      }
      return next === 'continue';
    };
    while (!disposed && !abortSignal.aborted) {
      const observedAtMs = nowMs();
      let liveness;
      try {
        liveness = await opts.hostAdapter.evaluateLiveness(opts.handle);
      } catch {
        if (!(await continueAfterDelay())) return;
        continue;
      }
      if (disposed || abortSignal.aborted) return;
      if (!liveness.paneAlive) {
        if (!(await continueAfterDelay())) return;
        continue;
      }

      if (opts.hostAdapter.captureInputState) {
        let inputState;
        try {
          inputState = await opts.hostAdapter.captureInputState(opts.handle);
        } catch {
          if (!(await continueAfterDelay())) return;
          continue;
        }
        if (disposed || abortSignal.aborted) return;
        opts.arbiter.observeUserTypingState({
          userTyping: !inputState.stable,
          observedAtMs: inputState.observedAt,
        });
        if (inputState.stable) {
          await observeReady(inputState.observedAt);
          return;
        }
      } else {
        await observeReady(observedAtMs);
        return;
      }

      if (!(await continueAfterDelay())) return;
    }
  };

  return {
    start({ abortSignal }) {
      if (disposed || started) return;
      started = true;
      return pollUntilReady(abortSignal);
    },
    dispose() {
      disposed = true;
      clearQuietDrainTimer();
    },
  };
}
