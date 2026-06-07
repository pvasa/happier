import { describe, expect, it, vi } from 'vitest';

import { createClaudeUnifiedPendingQueuePump } from './createClaudeUnifiedPendingQueuePump';

describe('createClaudeUnifiedPendingQueuePump', () => {
  it('enqueues batches already produced by SessionProviderInputConsumer without materializing again', async () => {
    const waitForNextInput = vi.fn().mockResolvedValue({
      message: 'from queue',
      mode: { permissionMode: 'default' },
      isolate: false,
      hash: 'same-mode',
    });
    const drainPending = vi.fn();
    const enqueueUiMessage = vi.fn().mockResolvedValue(undefined);
    const drainWhenSafe = vi.fn().mockResolvedValue(undefined);

    const pump = createClaudeUnifiedPendingQueuePump({
      inputConsumer: { waitForNextInput, drainPending },
      arbiter: { enqueueUiMessage, drainWhenSafe },
    });

    await pump.pumpOnce({ abortSignal: new AbortController().signal });

    expect(enqueueUiMessage).toHaveBeenCalledWith({
      message: 'from queue',
      mode: { permissionMode: 'default' },
      origin: { kind: 'ui_pending' },
    });
    expect(drainWhenSafe).toHaveBeenCalledTimes(1);
    expect(drainPending).not.toHaveBeenCalled();
  });

  it('delegates explicit pending drain to SessionProviderInputConsumer', async () => {
    const drainPending = vi.fn().mockResolvedValue({ materialized: 2, stoppedReason: 'no_pending' });
    const pump = createClaudeUnifiedPendingQueuePump({
      inputConsumer: {
        waitForNextInput: vi.fn(),
        drainPending,
      },
      arbiter: { enqueueUiMessage: vi.fn(), drainWhenSafe: vi.fn() },
    });

    await expect(pump.drainPending({ reason: 'unified-test' })).resolves.toEqual({
      materialized: 2,
      stoppedReason: 'no_pending',
    });
    expect(drainPending).toHaveBeenCalledWith({ reason: 'unified-test' });
  });

  it('returns an observable running promise from start when input waiting fails', async () => {
    const error = new Error('pending materialization failed');
    const pump = createClaudeUnifiedPendingQueuePump({
      inputConsumer: {
        waitForNextInput: vi.fn().mockRejectedValue(error),
      },
      arbiter: { enqueueUiMessage: vi.fn(), drainWhenSafe: vi.fn() },
    });

    const startResult: unknown = pump.start({ abortSignal: new AbortController().signal });

    expect(startResult).toBeInstanceOf(Promise);
    await expect(startResult).rejects.toBe(error);
  });

  it('returns an observable running promise from start when safe drain fails', async () => {
    const error = new Error('drain failed');
    const pump = createClaudeUnifiedPendingQueuePump({
      inputConsumer: {
        waitForNextInput: vi.fn().mockResolvedValue({
          message: 'from queue',
          mode: undefined,
          isolate: false,
          hash: 'same-mode',
        }),
      },
      arbiter: {
        enqueueUiMessage: vi.fn().mockResolvedValue(undefined),
        drainWhenSafe: vi.fn().mockRejectedValue(error),
      },
    });

    const startResult: unknown = pump.start({ abortSignal: new AbortController().signal });

    expect(startResult).toBeInstanceOf(Promise);
    await expect(startResult).rejects.toBe(error);
  });

  it('resolves the running promise after disposal when the consumer stops', async () => {
    let resolveInput!: (value: null) => void;
    const pump = createClaudeUnifiedPendingQueuePump({
      inputConsumer: {
        waitForNextInput: vi.fn(() => new Promise<null>((resolve) => {
          resolveInput = resolve;
        })),
      },
      arbiter: { enqueueUiMessage: vi.fn(), drainWhenSafe: vi.fn() },
    });

    const startResult = pump.start({ abortSignal: new AbortController().signal });
    pump.dispose();
    resolveInput(null);

    await expect(startResult).resolves.toBeUndefined();
  });
});
