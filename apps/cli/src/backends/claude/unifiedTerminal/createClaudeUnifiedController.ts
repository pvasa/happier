import type {
  ClaudeUnifiedDisposable,
  ClaudeUnifiedInputArbiter,
  ClaudeUnifiedStartableDisposable,
  ClaudeUnifiedTerminalHost,
} from './_types';
import type { TerminalHostLiveness } from '@/agent/runtime/terminal/_types';

export class ClaudeUnifiedTerminalHostDeadError extends Error {
  readonly code = 'claude_unified_terminal_host_dead';
  readonly liveness: TerminalHostLiveness | undefined;

  constructor(liveness?: TerminalHostLiveness | undefined) {
    super('Claude unified terminal host is not alive');
    this.name = 'ClaudeUnifiedTerminalHostDeadError';
    this.liveness = liveness;
  }
}

export type ClaudeUnifiedController = Readonly<{
  run(): Promise<void>;
  dispose(): Promise<void>;
}>;

export function createClaudeUnifiedController(opts: Readonly<{
  host: ClaudeUnifiedTerminalHost;
  pendingQueuePump: ClaudeUnifiedStartableDisposable;
  arbiter: Pick<ClaudeUnifiedInputArbiter, 'dispose'>;
  transcriptBridge?: ClaudeUnifiedStartableDisposable | undefined;
  onFatalError?: ((error: unknown) => void) | undefined;
}>): ClaudeUnifiedController {
  const abortController = new AbortController();
  let disposed = false;
  let running = false;

  const disposeOne = async (
    disposable: ClaudeUnifiedDisposable | null | undefined,
    firstError: unknown,
  ): Promise<unknown> => {
    try {
      await Promise.resolve(disposable?.dispose());
    } catch (error) {
      return firstError ?? error;
    }
    return firstError;
  };

  const dispose = async (): Promise<void> => {
    if (disposed) return;
    disposed = true;
    let firstError: unknown = null;
    abortController.abort('claude-unified-controller-dispose');
    firstError = await disposeOne(opts.pendingQueuePump, firstError);
    firstError = await disposeOne(opts.transcriptBridge, firstError);
    firstError = await disposeOne(opts.arbiter, firstError);
    firstError = await disposeOne(opts.host, firstError);
    if (firstError) throw firstError;
  };

  const handleSupervisedFailure = (error: unknown): void => {
    if (disposed) return;
    opts.onFatalError?.(error);
    abortController.abort(error);
  };

  const startSupervised = (
    startable: ClaudeUnifiedStartableDisposable | null | undefined,
  ): void => {
    if (!startable) return;
    const started = startable.start({ abortSignal: abortController.signal });
    void Promise.resolve(started).catch(handleSupervisedFailure);
  };

  return {
    async run() {
      if (disposed) return;
      if (running) return;
      running = true;
      const liveness = await opts.host.evaluateLiveness();
      if (!liveness.paneAlive) {
        await dispose().catch(() => undefined);
        throw new ClaudeUnifiedTerminalHostDeadError(liveness);
      }
      try {
        startSupervised(opts.transcriptBridge);
        startSupervised(opts.pendingQueuePump);
      } catch (error) {
        await dispose().catch(() => undefined);
        throw error;
      }
    },
    dispose,
  };
}
