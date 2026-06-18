import { describe, expect, it, vi } from 'vitest';

import { hermesModeLoop } from '@/backends/hermes/localControl/hermesModeLoop';

function fakeSession() {
  return { keepAlive: vi.fn() };
}

describe('hermesModeLoop', () => {
  it('returns the local exit code when local mode exits directly', async () => {
    const runLocal = vi.fn().mockResolvedValue({ type: 'exit', code: 7 });
    const runRemote = vi.fn().mockResolvedValue('exit');
    const code = await hermesModeLoop({
      startingMode: 'local',
      onModeChange: vi.fn(),
      session: fakeSession(),
      runLocal,
      runRemote,
    });
    expect(code).toBe(7);
    expect(runLocal).toHaveBeenCalledTimes(1);
    expect(runRemote).not.toHaveBeenCalled();
  });

  it('hands off local -> remote on switch and ends when remote exits', async () => {
    const runLocal = vi.fn().mockResolvedValue({ type: 'switch', resumeId: 'S1' });
    const runRemote = vi.fn().mockResolvedValue('exit');
    const onModeChange = vi.fn();
    const session = fakeSession();
    const code = await hermesModeLoop({ startingMode: 'local', onModeChange, session, runLocal, runRemote });
    expect(code).toBe(0);
    expect(onModeChange).toHaveBeenCalledWith('remote');
    expect(session.keepAlive).toHaveBeenCalledWith(false, 'remote');
  });

  it('can start in remote mode and switch back to local', async () => {
    const runRemote = vi.fn().mockResolvedValueOnce('switch');
    const runLocal = vi.fn().mockResolvedValue({ type: 'exit', code: 0 });
    const onModeChange = vi.fn();
    const code = await hermesModeLoop({
      startingMode: 'remote',
      onModeChange,
      session: fakeSession(),
      runLocal,
      runRemote,
    });
    expect(code).toBe(0);
    expect(runRemote).toHaveBeenCalledTimes(1);
    expect(runLocal).toHaveBeenCalledTimes(1);
    expect(onModeChange).toHaveBeenCalledWith('local');
  });
});
