import { describe, it, expect } from 'vitest';

import { resolveHermesLocalControlSupport } from '@/backends/hermes/localControl/resolveHermesLocalControlSupport';

describe('resolveHermesLocalControlSupport', () => {
  it('supports local control when a TTY is present and remote is not forced', () => {
    expect(resolveHermesLocalControlSupport({ hasTTY: true, forceRemote: false })).toEqual({ ok: true });
  });

  it('refuses local control without a TTY', () => {
    expect(resolveHermesLocalControlSupport({ hasTTY: false, forceRemote: false })).toEqual({
      ok: false,
      reason: 'tty_unavailable',
    });
  });

  it('refuses local control when remote is explicitly forced', () => {
    expect(resolveHermesLocalControlSupport({ hasTTY: true, forceRemote: true })).toEqual({
      ok: false,
      reason: 'forced_remote',
    });
  });

  it('reports forced_remote with precedence when both forced and no TTY', () => {
    expect(resolveHermesLocalControlSupport({ hasTTY: false, forceRemote: true })).toEqual({
      ok: false,
      reason: 'forced_remote',
    });
  });
});
