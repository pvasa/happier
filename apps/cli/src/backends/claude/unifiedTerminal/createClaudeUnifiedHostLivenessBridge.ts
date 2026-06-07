import type { TerminalHostAdapter, TerminalHostHandle, TerminalHostLiveness } from '@/integrations/terminalHost/_types';

import { ClaudeUnifiedTerminalHostDeadError } from './createClaudeUnifiedController';
import type { ClaudeUnifiedStartableDisposable } from './_types';
import { emitClaudeUnifiedHostDead, type ClaudeUnifiedTelemetrySink } from './telemetry';

const DEFAULT_HOST_LIVENESS_POLL_MS = 1_000;

function wait(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

export function createClaudeUnifiedHostLivenessBridge(opts: Readonly<{
  hostAdapter: Pick<TerminalHostAdapter, 'evaluateLiveness'>;
  handle: TerminalHostHandle;
  onHostDead: (error: ClaudeUnifiedTerminalHostDeadError) => void | Promise<void>;
  telemetry?: ClaudeUnifiedTelemetrySink | undefined;
  pollIntervalMs?: number | undefined;
  startupGraceMs?: number | undefined;
  startupGraceActive?: (() => boolean) | undefined;
  nowMs?: (() => number) | undefined;
}>): ClaudeUnifiedStartableDisposable {
  const pollIntervalMs = Math.max(1, Math.trunc(opts.pollIntervalMs ?? DEFAULT_HOST_LIVENESS_POLL_MS));
  const startupGraceMs = Math.max(0, Math.trunc(opts.startupGraceMs ?? 0));
  const nowMs = opts.nowMs ?? Date.now;
  let disposed = false;
  let started = false;
  let reported = false;
  let startedAtMs = 0;

  const reportHostDead = async (liveness?: TerminalHostLiveness | undefined): Promise<void> => {
    if (reported || disposed) return;
    reported = true;
    if (opts.telemetry) {
      try {
        emitClaudeUnifiedHostDead(opts.telemetry, {
          hostKind: opts.handle.kind,
          sessionName: opts.handle.sessionName,
          paneId: opts.handle.paneId,
          liveness,
        });
      } catch {
        // Telemetry is diagnostic-only; host death must still reach the fatal path.
      }
    }
    await opts.onHostDead(new ClaudeUnifiedTerminalHostDeadError(liveness));
  };

  const monitor = async (abortSignal: AbortSignal): Promise<void> => {
    while (!disposed && !abortSignal.aborted) {
      await wait(pollIntervalMs);
      if (disposed || abortSignal.aborted) return;
      const liveness = await opts.hostAdapter.evaluateLiveness(opts.handle);
      if (disposed || abortSignal.aborted) return;
      if (!liveness.paneAlive) {
        const graceActive = opts.startupGraceActive?.() ?? true;
        if (graceActive && startupGraceMs > 0 && nowMs() - startedAtMs < startupGraceMs) {
          continue;
        }
        await reportHostDead(liveness);
        return;
      }
    }
  };

  return {
    start({ abortSignal }) {
      if (disposed || started) return;
      started = true;
      startedAtMs = nowMs();
      return monitor(abortSignal).catch(async () => {
        await reportHostDead();
      });
    },
    dispose() {
      disposed = true;
    },
  };
}
