import { describe, expect, it } from 'vitest';

import { hermesChatExitCode } from '@/backends/hermes/localControl/createHermesChatSpawner';

describe('hermesChatExitCode', () => {
  it('passes through the exit code when the TUI exits normally', () => {
    expect(hermesChatExitCode({ type: 'exited', code: 3 })).toBe(3);
    expect(hermesChatExitCode({ type: 'exited', code: 0 })).toBe(0);
  });

  it('treats a signal (e.g. SIGTERM from a handoff) as a clean exit', () => {
    expect(hermesChatExitCode({ type: 'signaled', signal: 'SIGTERM' })).toBe(0);
  });

  it('reports failure for spawn errors and missing children', () => {
    expect(hermesChatExitCode({ type: 'spawn_error', errorName: 'Error', errorMessage: 'nope' })).toBe(1);
    expect(hermesChatExitCode({ type: 'missing' })).toBe(1);
  });
});
