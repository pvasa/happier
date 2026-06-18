import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { openSqliteDatabaseSync } from '@/daemon/memory/sqliteSync';
import { discoverHermesSessionIdSince } from '@/backends/hermes/localControl/hermesSessionDiscovery';

let dir: string;
let dbPath: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'hh-hermes-disc-'));
  dbPath = join(dir, 'state.db');
  const db = openSqliteDatabaseSync(dbPath);
  db.exec('CREATE TABLE sessions (id TEXT PRIMARY KEY, source TEXT, started_at REAL NOT NULL)');
  const ins = db.prepare('INSERT INTO sessions (id, source, started_at) VALUES (?, ?, ?)');
  ins.run('old', 'cli', 100);
  ins.run('newer', 'cli', 200);
  ins.run('newest', 'cli', 300);
  db.close();
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('discoverHermesSessionIdSince', () => {
  it('returns the newest session started at or after the cutoff', () => {
    const db = openSqliteDatabaseSync(dbPath, { readOnly: true });
    try {
      expect(discoverHermesSessionIdSince(db, 200)).toBe('newest');
    } finally {
      db.close();
    }
  });

  it('returns null when no session is new enough', () => {
    const db = openSqliteDatabaseSync(dbPath, { readOnly: true });
    try {
      expect(discoverHermesSessionIdSince(db, 400)).toBeNull();
    } finally {
      db.close();
    }
  });
});
