import { describe, expect, it } from 'vitest';

import { resolveHermesStartingMode } from '@/backends/hermes/localControl/resolveHermesStartingMode';

describe('resolveHermesStartingMode', () => {
  it('defaults a foreground TTY launch to local (parity with happier opencode)', () => {
    expect(resolveHermesStartingMode({ startedBy: 'terminal', hasTTY: true, forceRemote: false })).toBe('local');
  });

  it('falls back to remote without a TTY', () => {
    expect(resolveHermesStartingMode({ startedBy: 'terminal', hasTTY: false, forceRemote: false })).toBe('remote');
  });

  it('keeps daemon-started sessions remote even on a TTY', () => {
    expect(resolveHermesStartingMode({ startedBy: 'daemon', hasTTY: true, forceRemote: false })).toBe('remote');
  });

  it('honors force-remote even for a foreground TTY', () => {
    expect(resolveHermesStartingMode({ startedBy: 'terminal', hasTTY: true, forceRemote: true })).toBe('remote');
  });

  it('honors an explicit local request when supported, else remote', () => {
    expect(resolveHermesStartingMode({ explicit: 'local', startedBy: 'daemon', hasTTY: true, forceRemote: false })).toBe('local');
    expect(resolveHermesStartingMode({ explicit: 'local', startedBy: 'terminal', hasTTY: false, forceRemote: false })).toBe('remote');
  });

  it('honors an explicit remote request', () => {
    expect(resolveHermesStartingMode({ explicit: 'remote', startedBy: 'terminal', hasTTY: true, forceRemote: false })).toBe('remote');
  });
});
