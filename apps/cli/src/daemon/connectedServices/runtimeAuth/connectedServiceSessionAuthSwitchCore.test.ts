import { describe, expect, it } from 'vitest';

import {
  ConnectedServiceSessionAuthSwitchLockRegistry,
  createConnectedServiceSessionAuthSwitchCore,
} from './connectedServiceSessionAuthSwitchCore';

describe('connectedServiceSessionAuthSwitchCore', () => {
  it('serializes concurrent switches for the same session', async () => {
    const core = createConnectedServiceSessionAuthSwitchCore({
      locks: new ConnectedServiceSessionAuthSwitchLockRegistry(),
    });
    const events: string[] = [];
    let releaseFirst!: () => void;
    const firstCanFinish = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = core.run({
      sessionId: 'session-1',
      reason: 'automatic_runtime_failure',
      execute: async () => {
        events.push('first:start');
        await firstCanFinish;
        events.push('first:end');
        return { status: 'first' as const };
      },
    });

    await Promise.resolve();

    const second = core.run({
      sessionId: 'session-1',
      reason: 'manual',
      execute: async () => {
        events.push('second:start');
        return { status: 'second' as const };
      },
    });

    await Promise.resolve();
    expect(events).toEqual(['first:start']);

    releaseFirst();
    await expect(first).resolves.toEqual({ status: 'first' });
    await expect(second).resolves.toEqual({ status: 'second' });
    expect(events).toEqual(['first:start', 'first:end', 'second:start']);
  });
});
