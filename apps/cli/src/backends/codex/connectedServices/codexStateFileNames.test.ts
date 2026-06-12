import { describe, expect, it } from 'vitest';

import {
  isCodexShareableSqliteStateEntry,
  resolveConfiguredCodexSqliteHome,
} from './codexStateFileNames';

describe('codexStateFileNames', () => {
  it('classifies state, goals, and logs SQLite files (with wal/shm sidecars) as shareable Codex SQLite state', () => {
    expect(isCodexShareableSqliteStateEntry('state_5.sqlite')).toBe(true);
    expect(isCodexShareableSqliteStateEntry('state_5.sqlite-wal')).toBe(true);
    expect(isCodexShareableSqliteStateEntry('state_5.sqlite-shm')).toBe(true);
    expect(isCodexShareableSqliteStateEntry('goals_1.sqlite')).toBe(true);
    expect(isCodexShareableSqliteStateEntry('goals_1.sqlite-wal')).toBe(true);
    expect(isCodexShareableSqliteStateEntry('logs_2.sqlite')).toBe(true);
    expect(isCodexShareableSqliteStateEntry('logs_2.sqlite-shm')).toBe(true);
    expect(isCodexShareableSqliteStateEntry('logs_2.sqlite-wal')).toBe(true);
    expect(isCodexShareableSqliteStateEntry('state_5.sqlite-journal')).toBe(false);
  });

  it('resolves CODEX_SQLITE_HOME before falling back to CODEX_HOME', () => {
    expect(resolveConfiguredCodexSqliteHome({
      CODEX_HOME: '/tmp/codex-home',
      CODEX_SQLITE_HOME: '/tmp/codex-sqlite-home',
    })).toBe('/tmp/codex-sqlite-home');
    expect(resolveConfiguredCodexSqliteHome({
      CODEX_HOME: '/tmp/codex-home',
      CODEX_SQLITE_HOME: '   ',
    })).toBe('/tmp/codex-home');
  });

  it('expands home-relative CODEX_SQLITE_HOME before resolving relative paths', () => {
    expect(resolveConfiguredCodexSqliteHome({
      HOME: '/Users/alice',
      CODEX_SQLITE_HOME: '~/.codex-state',
    }, '/work/repo')).toBe('/Users/alice/.codex-state');

    expect(resolveConfiguredCodexSqliteHome({
      HOME: '/Users/alice',
      CODEX_SQLITE_HOME: 'relative-sqlite',
    }, '/work/repo')).toBe('/work/repo/relative-sqlite');
  });
});
