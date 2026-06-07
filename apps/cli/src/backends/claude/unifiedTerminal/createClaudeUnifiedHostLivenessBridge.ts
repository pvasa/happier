import type { TerminalHostAdapter, TerminalHostHandle, TerminalHostLiveness } from '@/integrations/terminalHost/_types';
import { sanitizeTerminalHostDiagnosticText } from '@/integrations/terminalHost/sanitizeTerminalHostDiagnosticText';

import { ClaudeUnifiedTerminalHostDeadError } from './createClaudeUnifiedController';
import type { ClaudeUnifiedStartableDisposable } from './_types';
import { emitClaudeUnifiedHostDead, type ClaudeUnifiedTelemetrySink } from './telemetry';

const DEFAULT_HOST_LIVENESS_POLL_MS = 1_000;

function wait(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function mergeDeadLivenessDiagnostics(
  pending: TerminalHostLiveness,
  latest: TerminalHostLiveness,
): TerminalHostLiveness {
  return { ...pending, ...latest };
}

function createProbeFailureLiveness(
  error: unknown,
  observedAt: number,
): TerminalHostLiveness {
  const message = error instanceof Error ? error.message : String(error);
  return {
    paneAlive: false,
    paneScreenDumpError: sanitizeTerminalHostDiagnosticText(message),
    observedAt,
  };
}

export function createClaudeUnifiedHostLivenessBridge(opts: Readonly<{
  hostAdapter: Pick<TerminalHostAdapter, 'evaluateLiveness'>;
  handle: TerminalHostHandle;
  onHostDead: (error: ClaudeUnifiedTerminalHostDeadError) => void | Promise<void>;
  onHostExited?: ((liveness: TerminalHostLiveness) => void | Promise<void>) | undefined;
  isExpectedHostExit?: ((liveness: TerminalHostLiveness) => boolean) | undefined;
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
  let pendingDeadLiveness: TerminalHostLiveness | null = null;

  const reportHostExited = async (liveness: TerminalHostLiveness): Promise<void> => {
    if (reported || disposed) return;
    reported = true;
    await opts.onHostExited?.(liveness);
  };

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
      let liveness: TerminalHostLiveness;
      try {
        liveness = await opts.hostAdapter.evaluateLiveness(opts.handle);
      } catch (error) {
        liveness = createProbeFailureLiveness(error, nowMs());
      }
      if (disposed || abortSignal.aborted) return;
      if (!liveness.paneAlive) {
        const graceActive = opts.startupGraceActive?.() ?? true;
        if (graceActive && startupGraceMs > 0 && nowMs() - startedAtMs < startupGraceMs) {
          pendingDeadLiveness = null;
          continue;
        }
        if (opts.isExpectedHostExit?.(liveness) === true) {
          await reportHostExited(liveness);
          return;
        }
        if (pendingDeadLiveness === null) {
          pendingDeadLiveness = liveness;
          continue;
        }
        await reportHostDead(mergeDeadLivenessDiagnostics(pendingDeadLiveness, liveness));
        return;
      }
      pendingDeadLiveness = null;
    }
  };

  return {
    start({ abortSignal }) {
      if (disposed || started) return;
      started = true;
      startedAtMs = nowMs();
      return monitor(abortSignal);
    },
    dispose() {
      disposed = true;
    },
  };
}
