import type { DrainPendingOptions, DrainPendingResult } from '@/agent/runtime/sessionInput/types';

import type {
  ClaudeUnifiedInputArbiter,
  ClaudeUnifiedInputConsumer,
  ClaudeUnifiedPendingQueuePump,
} from './_types';

export function createClaudeUnifiedPendingQueuePump<Mode = unknown>(opts: Readonly<{
  inputConsumer: ClaudeUnifiedInputConsumer<Mode>;
  arbiter: Pick<ClaudeUnifiedInputArbiter<Mode>, 'enqueueUiMessage' | 'drainWhenSafe'>;
}>): ClaudeUnifiedPendingQueuePump<Mode> {
  let disposed = false;
  let runPromise: Promise<void> | null = null;

  const pumpOnce = async (pumpOpts: { abortSignal: AbortSignal }): Promise<boolean> => {
    if (disposed || pumpOpts.abortSignal.aborted) {
      return false;
    }
    const batch = await opts.inputConsumer.waitForNextInput({ abortSignal: pumpOpts.abortSignal });
    if (!batch || pumpOpts.abortSignal.aborted || disposed) {
      return false;
    }
    await opts.arbiter.enqueueUiMessage({
      message: batch.message,
      mode: batch.mode,
      origin: { kind: 'ui_pending' },
    });
    await opts.arbiter.drainWhenSafe();
    return true;
  };

  const run = async (runOpts: { abortSignal: AbortSignal }): Promise<void> => {
    while (!disposed && !runOpts.abortSignal.aborted) {
      const pumped = await pumpOnce(runOpts);
      if (!pumped) return;
    }
  };

  return {
    pumpOnce,
    async drainPending(drainOpts?: DrainPendingOptions): Promise<DrainPendingResult | null> {
      return await (opts.inputConsumer.drainPending?.(drainOpts) ?? Promise.resolve(null));
    },
    start(startOpts) {
      if (runPromise) return runPromise;
      if (disposed) return Promise.resolve();
      runPromise = run(startOpts).finally(() => {
        runPromise = null;
      });
      return runPromise;
    },
    dispose() {
      disposed = true;
    },
  };
}
