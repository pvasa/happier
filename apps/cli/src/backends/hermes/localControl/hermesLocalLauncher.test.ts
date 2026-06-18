import { describe, expect, it, vi } from 'vitest';

import { hermesLocalLauncher, type HermesLauncherChild } from '@/backends/hermes/localControl/hermesLocalLauncher';
import type { HermesSessionMirror } from '@/backends/hermes/localControl/createHermesSessionMirror';
import type { HermesMirrorSessionWriter } from '@/backends/hermes/localControl/createHermesSessionMirrorSink';

function fakeChild() {
  let exitCb: ((code: number | null) => void) | null = null;
  const kill = vi.fn();
  const child: HermesLauncherChild = { onExit: (cb) => { exitCb = cb; }, kill };
  return { child, kill, emitExit: (code: number) => exitCb?.(code) };
}

function fakeSession(): HermesMirrorSessionWriter {
  return { sendUserTextMessage: vi.fn(), sendAgentMessage: vi.fn() };
}

function fakeMirror(): HermesSessionMirror {
  return { start: vi.fn(), stop: vi.fn(), pollNow: vi.fn() };
}

function fakeQueue() {
  let onMessage: ((m: string, mode: string) => void) | null = null;
  return {
    port: { setOnMessage: (cb: ((m: string, mode: string) => void) | null) => { onMessage = cb; } },
    deliver: (m: string) => onMessage?.(m, 'default'),
    isCleared: () => onMessage === null,
  };
}

describe('hermesLocalLauncher', () => {
  it('returns an exit result when the native TUI exits, stopping the mirror and restoring remote mode', async () => {
    const { child, emitExit } = fakeChild();
    const mirror = fakeMirror();
    const queue = fakeQueue();
    const publishRemoteMode = vi.fn();
    const promise = hermesLocalLauncher({
      sessionId: 'S1',
      stateDbPath: '/x/state.db',
      chatArgs: ['chat', '--resume', 'S1'],
      spawnChat: () => child,
      session: fakeSession(),
      modeControls: { publishLocalMode: vi.fn(), publishRemoteMode },
      messageQueue: queue.port,
      createMirror: () => mirror,
    });
    await Promise.resolve();
    emitExit(0);
    const result = await promise;
    expect(result).toEqual({ type: 'exit', code: 0 });
    expect(mirror.start).toHaveBeenCalledTimes(1);
    expect(mirror.stop).toHaveBeenCalledTimes(1);
    expect(queue.isCleared()).toBe(true);
    expect(publishRemoteMode).toHaveBeenCalledTimes(1);
  });

  it('returns a switch result when a phone message arrives, killing the TUI to hand off', async () => {
    const { child, kill, emitExit } = fakeChild();
    const queue = fakeQueue();
    const promise = hermesLocalLauncher({
      sessionId: 'S1',
      stateDbPath: '/x/state.db',
      chatArgs: ['chat'],
      spawnChat: () => child,
      session: fakeSession(),
      modeControls: { publishLocalMode: vi.fn(), publishRemoteMode: vi.fn() },
      messageQueue: queue.port,
      createMirror: () => fakeMirror(),
    });
    await Promise.resolve();
    queue.deliver('take over from phone');
    await vi.waitFor(() => expect(kill).toHaveBeenCalled());
    emitExit(0); // killing the TUI makes it exit
    const result = await promise;
    expect(result).toEqual({ type: 'switch', resumeId: 'S1' });
  });
});
