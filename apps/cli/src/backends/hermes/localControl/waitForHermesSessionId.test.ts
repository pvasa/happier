import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { openSqliteDatabaseSync } from '@/daemon/memory/sqliteSync';
import { waitForHermesSessionId } from '@/backends/hermes/localControl/waitForHermesSessionId';

let dir: string;
let dbPath: string;

function createSessionsDb(): void {
  const db = openSqliteDatabaseSync(dbPath);
  db.exec('CREATE TABLE sessions (id TEXT PRIMARY KEY, source TEXT, started_at REAL NOT NULL)');
  db.close();
}

function insertSession(id: string, startedAt: number): void {
  const db = openSqliteDatabaseSync(dbPath);
  db.prepare('INSERT INTO sessions (id, source, started_at) VALUES (?, ?, ?)').run(id, 'cli', startedAt);
  db.close();
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'hh-hermes-wait-'));
  dbPath = join(dir, 'state.db');
  createSessionsDb();
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('waitForHermesSessionId', () => {
  it('returns immediately when a matching session already exists', async () => {
    insertSession('already-here', 500);
    const id = await waitForHermesSessionId({ stateDbPath: dbPath, sinceEpochSeconds: 100, timeoutMs: 50, intervalMs: 5 });
    expect(id).toBe('already-here');
  });

  it('returns null when no session appears before the timeout', async () => {
    const id = await waitForHermesSessionId({ stateDbPath: dbPath, sinceEpochSeconds: 100000, timeoutMs: 30, intervalMs: 5 });
    expect(id).toBeNull();
  });
});
