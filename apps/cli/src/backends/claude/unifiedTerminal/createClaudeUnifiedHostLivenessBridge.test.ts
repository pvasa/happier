import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TerminalHostHandle } from '@/integrations/terminalHost/_types';

import { createClaudeUnifiedHostLivenessBridge } from './createClaudeUnifiedHostLivenessBridge';

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

describe('createClaudeUnifiedHostLivenessBridge', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('treats dead-pane observations during startup grace as transient', async () => {
    vi.useFakeTimers();
    let nowMs = 0;
    const evaluateLiveness = vi.fn(async () => ({ paneAlive: false, observedAt: nowMs }));
    const onHostDead = vi.fn(async () => undefined);
    const bridge = createClaudeUnifiedHostLivenessBridge({
      hostAdapter: { evaluateLiveness },
      handle,
      onHostDead,
      pollIntervalMs: 10,
      startupGraceMs: 50,
      nowMs: () => nowMs,
    });
    const abortController = new AbortController();

    bridge.start({ abortSignal: abortController.signal });

    nowMs += 10;
    await vi.advanceTimersByTimeAsync(10);
    expect(onHostDead).not.toHaveBeenCalled();

    evaluateLiveness.mockResolvedValueOnce({ paneAlive: true, observedAt: nowMs });
    nowMs += 10;
    await vi.advanceTimersByTimeAsync(10);
    expect(onHostDead).not.toHaveBeenCalled();

    bridge.dispose();
    abortController.abort();
  });

  it('does not report host death for a single transient dead observation after startup grace', async () => {
    vi.useFakeTimers();
    let nowMs = 100;
    const evaluateLiveness = vi
      .fn()
      .mockResolvedValueOnce({ paneAlive: false, paneDead: true, observedAt: 110 })
      .mockResolvedValueOnce({ paneAlive: true, paneDead: false, observedAt: 120 });
    const onHostDead = vi.fn(async () => undefined);
    const bridge = createClaudeUnifiedHostLivenessBridge({
      hostAdapter: { evaluateLiveness },
      handle,
      onHostDead,
      pollIntervalMs: 10,
      startupGraceMs: 0,
      startupGraceActive: () => false,
      nowMs: () => nowMs,
    });
    const abortController = new AbortController();

    bridge.start({ abortSignal: abortController.signal });

    nowMs += 10;
    await vi.advanceTimersByTimeAsync(10);
    expect(onHostDead).not.toHaveBeenCalled();

    nowMs += 10;
    await vi.advanceTimersByTimeAsync(10);
    expect(onHostDead).not.toHaveBeenCalled();

    bridge.dispose();
    abortController.abort();
  });

  it('does not report host death for a single transient liveness probe failure after startup grace', async () => {
    vi.useFakeTimers();
    let nowMs = 100;
    const evaluateLiveness = vi
      .fn()
      .mockRejectedValueOnce(new Error('control plane unavailable'))
      .mockResolvedValueOnce({ paneAlive: true, observedAt: 120 });
    const onHostDead = vi.fn(async () => undefined);
    const bridge = createClaudeUnifiedHostLivenessBridge({
      hostAdapter: { evaluateLiveness },
      handle,
      onHostDead,
      pollIntervalMs: 10,
      startupGraceMs: 0,
      startupGraceActive: () => false,
      nowMs: () => nowMs,
    });
    const abortController = new AbortController();

    bridge.start({ abortSignal: abortController.signal });

    nowMs += 10;
    await vi.advanceTimersByTimeAsync(10);
    expect(onHostDead).not.toHaveBeenCalled();

    nowMs += 10;
    await vi.advanceTimersByTimeAsync(10);
    expect(onHostDead).not.toHaveBeenCalled();

    bridge.dispose();
    abortController.abort();
  });

  it('reports host death after startup grace expires', async () => {
    vi.useFakeTimers();
    let nowMs = 0;
    const deadLiveness = {
      paneAlive: false,
      paneDead: true,
      paneCurrentCommand: '/managed/node',
      paneExitStatus: 1,
      observedAt: 20,
    };
    const evaluateLiveness = vi.fn(async () => ({
      ...deadLiveness,
      observedAt: nowMs,
    }));
    const onHostDead = vi.fn(async () => undefined);
    const bridge = createClaudeUnifiedHostLivenessBridge({
      hostAdapter: { evaluateLiveness },
      handle,
      onHostDead,
      pollIntervalMs: 10,
      startupGraceMs: 15,
      nowMs: () => nowMs,
    });
    const abortController = new AbortController();

    bridge.start({ abortSignal: abortController.signal });

    nowMs += 10;
    await vi.advanceTimersByTimeAsync(10);
    expect(onHostDead).not.toHaveBeenCalled();

    nowMs += 10;
    await vi.advanceTimersByTimeAsync(10);
    expect(onHostDead).not.toHaveBeenCalled();

    nowMs += 10;
    await vi.advanceTimersByTimeAsync(10);
    expect(onHostDead).toHaveBeenCalledTimes(1);
    expect(onHostDead).toHaveBeenCalledWith(expect.objectContaining({
      code: 'claude_unified_terminal_host_dead',
      liveness: {
        ...deadLiveness,
        observedAt: nowMs,
      },
    }));

    bridge.dispose();
    abortController.abort();
  });

  it('reports host death after repeated liveness probe failures', async () => {
    vi.useFakeTimers();
    let nowMs = 100;
    const evaluateLiveness = vi.fn().mockRejectedValue(new Error('control plane unavailable'));
    const onHostDead = vi.fn(async () => undefined);
    const bridge = createClaudeUnifiedHostLivenessBridge({
      hostAdapter: { evaluateLiveness },
      handle,
      onHostDead,
      pollIntervalMs: 10,
      startupGraceMs: 0,
      startupGraceActive: () => false,
      nowMs: () => nowMs,
    });
    const abortController = new AbortController();

    bridge.start({ abortSignal: abortController.signal });

    nowMs += 10;
    await vi.advanceTimersByTimeAsync(10);
    expect(onHostDead).not.toHaveBeenCalled();

    nowMs += 10;
    await vi.advanceTimersByTimeAsync(10);
    expect(onHostDead).toHaveBeenCalledTimes(1);
    expect(onHostDead).toHaveBeenCalledWith(expect.objectContaining({
      code: 'claude_unified_terminal_host_dead',
    }));

    bridge.dispose();
    abortController.abort();
  });

  it('preserves first dead-pane diagnostics when the confirming dead observation is sparse', async () => {
    vi.useFakeTimers();
    let nowMs = 100;
    const evaluateLiveness = vi
      .fn()
      .mockResolvedValueOnce({
        paneAlive: false,
        paneDead: true,
        paneCurrentCommand: '/managed/node',
        paneExitStatus: 127,
        paneScreenDumpCaptured: true,
        paneScreenDumpTruncated: false,
        observedAt: 110,
      })
      .mockResolvedValueOnce({
        paneAlive: false,
        paneDead: true,
        observedAt: 120,
      });
    const onHostDead = vi.fn(async () => undefined);
    const bridge = createClaudeUnifiedHostLivenessBridge({
      hostAdapter: { evaluateLiveness },
      handle,
      onHostDead,
      pollIntervalMs: 10,
      startupGraceMs: 0,
      startupGraceActive: () => false,
      nowMs: () => nowMs,
    });
    const abortController = new AbortController();

    bridge.start({ abortSignal: abortController.signal });

    nowMs += 10;
    await vi.advanceTimersByTimeAsync(10);
    expect(onHostDead).not.toHaveBeenCalled();

    nowMs += 10;
    await vi.advanceTimersByTimeAsync(10);
    expect(onHostDead).toHaveBeenCalledWith(expect.objectContaining({
      code: 'claude_unified_terminal_host_dead',
      liveness: expect.objectContaining({
        paneCurrentCommand: '/managed/node',
        paneExitStatus: 127,
        paneScreenDumpCaptured: true,
        paneScreenDumpTruncated: false,
        observedAt: 120,
      }),
    }));

    bridge.dispose();
    abortController.abort();
  });

  it('still reports host death when telemetry emit fails', async () => {
    vi.useFakeTimers();
    let nowMs = 0;
    const deadLiveness = {
      paneAlive: false,
      paneDead: true,
      paneCurrentCommand: '/managed/node',
      paneExitStatus: 1,
      observedAt: 10,
    };
    const evaluateLiveness = vi.fn(async () => deadLiveness);
    const onHostDead = vi.fn(async () => undefined);
    const bridge = createClaudeUnifiedHostLivenessBridge({
      hostAdapter: { evaluateLiveness },
      handle,
      telemetry: {
        emit: vi.fn(() => {
          throw new Error('telemetry sink failed');
        }),
      },
      onHostDead,
      pollIntervalMs: 10,
      nowMs: () => nowMs,
    });
    const abortController = new AbortController();

    bridge.start({ abortSignal: abortController.signal });
    nowMs += 10;
    await vi.advanceTimersByTimeAsync(10);
    expect(onHostDead).not.toHaveBeenCalled();

    nowMs += 10;
    await vi.advanceTimersByTimeAsync(10);

    expect(onHostDead).toHaveBeenCalledTimes(1);
    expect(onHostDead).toHaveBeenCalledWith(expect.objectContaining({
      code: 'claude_unified_terminal_host_dead',
      liveness: deadLiveness,
    }));

    bridge.dispose();
    abortController.abort();
  });
});
