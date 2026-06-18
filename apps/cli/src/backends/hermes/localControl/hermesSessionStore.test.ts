import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { openSqliteDatabaseSync } from '@/daemon/memory/sqliteSync';
import { openHermesSessionStore, readHermesSessionRowsSince } from '@/backends/hermes/localControl/hermesSessionStore';

let dir: string;
let dbPath: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'hh-hermes-store-'));
  dbPath = join(dir, 'state.db');
  const db = openSqliteDatabaseSync(dbPath);
  db.exec(`CREATE TABLE messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT,
    tool_call_id TEXT,
    tool_calls TEXT,
    tool_name TEXT,
    timestamp REAL NOT NULL,
    reasoning TEXT,
    active INTEGER NOT NULL DEFAULT 1
  )`);
  const ins = db.prepare(
    `INSERT INTO messages (session_id, role, content, tool_call_id, tool_calls, tool_name, timestamp, reasoning, active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  ins.run('S1', 'user', 'hello', null, null, null, 1, null, 1);
  ins.run('S1', 'assistant', '', null, '[{"id":"c1","function":{"name":"do","arguments":"{}"}}]', null, 2, null, 1);
  ins.run('S1', 'assistant', 'superseded', null, null, null, 3, null, 0);
  ins.run('OTHER', 'user', 'not mine', null, null, null, 4, null, 1);
  ins.run('S1', 'assistant', 'final', null, null, null, 5, 'thinking', 1);
  db.close();
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('hermesSessionStore', () => {
  it('reads rows for a session after a cursor, in id order, coercing columns', () => {
    const db = openHermesSessionStore(dbPath);
    try {
      const rows = readHermesSessionRowsSince(db, 'S1', 0);
      expect(rows.map((r) => ({ id: r.id, role: r.role, content: r.content, active: r.active }))).toEqual([
        { id: 1, role: 'user', content: 'hello', active: true },
        { id: 2, role: 'assistant', content: '', active: true },
        { id: 3, role: 'assistant', content: 'superseded', active: false },
        { id: 5, role: 'assistant', content: 'final', active: true },
      ]);
      expect(rows[1].toolCalls).toContain('"name":"do"');
      expect(rows[3].reasoning).toBe('thinking');
    } finally {
      db.close();
    }
  });

  it('advances by the id cursor and isolates by session', () => {
    const db = openHermesSessionStore(dbPath);
    try {
      const rows = readHermesSessionRowsSince(db, 'S1', 2);
      expect(rows.map((r) => r.id)).toEqual([3, 5]);
    } finally {
      db.close();
    }
  });

  it('opens the store read-only so the mirror can never mutate Hermes data', () => {
    const db = openHermesSessionStore(dbPath);
    try {
      expect(() => db.exec("INSERT INTO messages (session_id, role, timestamp, active) VALUES ('S1','user',9,1)")).toThrow();
    } finally {
      db.close();
    }
  });
});
