import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TerminalHostHandle } from '@/integrations/terminalHost/_types';

import { createClaudeUnifiedTerminalReadinessBridge } from './createClaudeUnifiedTerminalReadinessBridge';

const handle: TerminalHostHandle = {
  kind: 'zellij',
  sessionName: 'happier-claude-unified-test',
  paneId: 'terminal_1',
  attachMetadata: {
    attachStrategy: 'terminal_host',
    topology: 'shared',
    locality: 'same_machine',
    liveProbe: 'required',
  },
};

function createArbiter() {
  return {
    observeLifecycle: vi.fn(),
    observeUserTypingState: vi.fn(),
    drainWhenSafe: vi.fn().mockResolvedValue(undefined),
  };
}

describe('createClaudeUnifiedTerminalReadinessBridge', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('retries after a transient liveness probe failure and still reports startup readiness', async () => {
    vi.useFakeTimers();
    let nowMs = 0;
    const arbiter = createArbiter();
    const onStartupReady = vi.fn();
    const evaluateLiveness = vi.fn()
      .mockRejectedValueOnce(new Error('control plane unavailable'))
      .mockResolvedValueOnce({ paneAlive: true, observedAt: 10 });
    const captureInputState = vi.fn().mockResolvedValue({
      stable: true,
      currentInput: '',
      observedAt: 10,
    });
    const bridge = createClaudeUnifiedTerminalReadinessBridge({
      hostAdapter: { evaluateLiveness, captureInputState },
      handle,
      arbiter,
      pollIntervalMs: 10,
      quietPeriodMs: 25,
      timeoutMs: 100,
      nowMs: () => nowMs,
      onStartupReady,
    });

    bridge.start({ abortSignal: new AbortController().signal });
    await Promise.resolve();
    nowMs += 10;
    await vi.advanceTimersByTimeAsync(10);

    expect(evaluateLiveness).toHaveBeenCalledTimes(2);
    expect(onStartupReady).toHaveBeenCalledTimes(1);
    expect(arbiter.observeLifecycle).toHaveBeenCalledWith({ type: 'output', observedAtMs: 10 });

    bridge.dispose();
  });

  it('retries after a transient input-state capture failure and still reports startup readiness', async () => {
    vi.useFakeTimers();
    let nowMs = 0;
    const arbiter = createArbiter();
    const onStartupReady = vi.fn();
    const evaluateLiveness = vi.fn().mockResolvedValue({ paneAlive: true, observedAt: 10 });
    const captureInputState = vi.fn()
      .mockRejectedValueOnce(new Error('capture unavailable'))
      .mockResolvedValueOnce({
        stable: true,
        currentInput: '',
        observedAt: 10,
      });
    const bridge = createClaudeUnifiedTerminalReadinessBridge({
      hostAdapter: { evaluateLiveness, captureInputState },
      handle,
      arbiter,
      pollIntervalMs: 10,
      quietPeriodMs: 25,
      timeoutMs: 100,
      nowMs: () => nowMs,
      onStartupReady,
    });

    bridge.start({ abortSignal: new AbortController().signal });
    await Promise.resolve();
    nowMs += 10;
    await vi.advanceTimersByTimeAsync(10);

    expect(captureInputState).toHaveBeenCalledTimes(2);
    expect(onStartupReady).toHaveBeenCalledTimes(1);
    expect(arbiter.observeUserTypingState).toHaveBeenCalledWith({
      userTyping: false,
      observedAtMs: 10,
    });

    bridge.dispose();
  });

  it('returns a supervised promise when readiness drain fails', async () => {
    const arbiter = createArbiter();
    const drainError = new Error('readiness drain failed');
    arbiter.drainWhenSafe.mockRejectedValue(drainError);
    const bridge = createClaudeUnifiedTerminalReadinessBridge({
      hostAdapter: {
        evaluateLiveness: vi.fn().mockResolvedValue({ paneAlive: true, observedAt: 10 }),
        captureInputState: vi.fn().mockResolvedValue({
          stable: true,
          currentInput: '',
          observedAt: 10,
        }),
      },
      handle,
      arbiter,
    });

    const started = bridge.start({ abortSignal: new AbortController().signal });

    expect(started).toBeInstanceOf(Promise);
    await expect(started).rejects.toBe(drainError);

    bridge.dispose();
  });

  it('keeps retrying repeated liveness probe failures until startup timeout', async () => {
    vi.useFakeTimers();
    let nowMs = 0;
    const arbiter = createArbiter();
    const evaluateLiveness = vi.fn().mockRejectedValue(new Error('control plane unavailable'));
    const bridge = createClaudeUnifiedTerminalReadinessBridge({
      hostAdapter: { evaluateLiveness },
      handle,
      arbiter,
      pollIntervalMs: 10,
      timeoutMs: 25,
      nowMs: () => nowMs,
      onStartupReady: vi.fn(),
    });

    const started = bridge.start({ abortSignal: new AbortController().signal });
    const startupTimeoutExpectation = expect(started).rejects.toMatchObject({
      code: 'claude_unified_terminal_readiness_timeout',
    });
    await Promise.resolve();
    nowMs += 10;
    await vi.advanceTimersByTimeAsync(10);
    nowMs += 10;
    await vi.advanceTimersByTimeAsync(10);
    nowMs += 10;
    await vi.advanceTimersByTimeAsync(10);

    expect(evaluateLiveness.mock.calls.length).toBeGreaterThan(1);
    expect(arbiter.observeLifecycle).not.toHaveBeenCalled();
    await startupTimeoutExpectation;

    bridge.dispose();
  });

  it('clears the quiet drain timer on disposal', async () => {
    vi.useFakeTimers();
    const arbiter = createArbiter();
    const bridge = createClaudeUnifiedTerminalReadinessBridge({
      hostAdapter: {
        evaluateLiveness: vi.fn().mockResolvedValue({ paneAlive: true, observedAt: 1 }),
        captureInputState: vi.fn().mockResolvedValue({
          stable: true,
          currentInput: '',
          observedAt: 1,
        }),
      },
      handle,
      arbiter,
      quietPeriodMs: 50,
      timeoutMs: 100,
    });

    bridge.start({ abortSignal: new AbortController().signal });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(arbiter.drainWhenSafe).toHaveBeenCalledTimes(1);

    bridge.dispose();
    await vi.advanceTimersByTimeAsync(50);

    expect(arbiter.drainWhenSafe).toHaveBeenCalledTimes(1);
  });

  it('does not report readiness when the host stays non-live through timeout', async () => {
    vi.useFakeTimers();
    let nowMs = 0;
    const arbiter = createArbiter();
    const onStartupReady = vi.fn();
    const evaluateLiveness = vi.fn().mockResolvedValue({ paneAlive: false, observedAt: 0 });
    const captureInputState = vi.fn();
    const bridge = createClaudeUnifiedTerminalReadinessBridge({
      hostAdapter: { evaluateLiveness, captureInputState },
      handle,
      arbiter,
      pollIntervalMs: 10,
      timeoutMs: 25,
      nowMs: () => nowMs,
      onStartupReady,
    });

    const started = bridge.start({ abortSignal: new AbortController().signal });
    const startupTimeoutExpectation = expect(started).rejects.toMatchObject({
      code: 'claude_unified_terminal_readiness_timeout',
    });
    await Promise.resolve();
    nowMs += 10;
    await vi.advanceTimersByTimeAsync(10);
    nowMs += 10;
    await vi.advanceTimersByTimeAsync(10);
    nowMs += 10;
    await vi.advanceTimersByTimeAsync(10);

    expect(onStartupReady).not.toHaveBeenCalled();
    expect(arbiter.observeLifecycle).not.toHaveBeenCalled();
    expect(captureInputState).not.toHaveBeenCalled();
    await startupTimeoutExpectation;

    bridge.dispose();
  });

  it('rejects the supervised startup task when readiness never arrives before timeout', async () => {
    vi.useFakeTimers();
    let nowMs = 0;
    const arbiter = createArbiter();
    const bridge = createClaudeUnifiedTerminalReadinessBridge({
      hostAdapter: {
        evaluateLiveness: vi.fn().mockResolvedValue({ paneAlive: true, observedAt: 0 }),
        captureInputState: vi.fn().mockResolvedValue({
          stable: false,
          currentInput: '',
          observedAt: 0,
        }),
      },
      handle,
      arbiter,
      pollIntervalMs: 10,
      timeoutMs: 25,
      nowMs: () => nowMs,
    });

    const started = bridge.start({ abortSignal: new AbortController().signal });
    const startupTimeoutExpectation = expect(started).rejects.toMatchObject({
      code: 'claude_unified_terminal_readiness_timeout',
    });
    nowMs += 10;
    await vi.advanceTimersByTimeAsync(10);
    nowMs += 10;
    await vi.advanceTimersByTimeAsync(10);
    nowMs += 10;
    await vi.advanceTimersByTimeAsync(10);

    await startupTimeoutExpectation;

    bridge.dispose();
  });
});
