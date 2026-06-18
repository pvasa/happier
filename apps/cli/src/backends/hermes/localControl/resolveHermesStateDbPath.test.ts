import { describe, expect, it } from 'vitest';

import { resolveHermesStateDbPath } from '@/backends/hermes/localControl/resolveHermesStateDbPath';

describe('resolveHermesStateDbPath', () => {
  it('defaults to <home>/.hermes/state.db', () => {
    expect(resolveHermesStateDbPath({ env: {}, homeDir: '/home/u' })).toBe('/home/u/.hermes/state.db');
  });

  it('honors HERMES_HOME', () => {
    expect(resolveHermesStateDbPath({ env: { HERMES_HOME: '/opt/hermes' }, homeDir: '/home/u' })).toBe(
      '/opt/hermes/state.db',
    );
  });

  it('honors an explicit HAPPIER_HERMES_STATE_DB override (home-expanded)', () => {
    expect(
      resolveHermesStateDbPath({ env: { HAPPIER_HERMES_STATE_DB: '~/custom/h.db' }, homeDir: '/home/u' }),
    ).toBe('/home/u/custom/h.db');
  });

  it('prefers the explicit db override over HERMES_HOME', () => {
    expect(
      resolveHermesStateDbPath({ env: { HERMES_HOME: '/opt/hermes', HAPPIER_HERMES_STATE_DB: '/abs/x.db' }, homeDir: '/home/u' }),
    ).toBe('/abs/x.db');
  });
});
