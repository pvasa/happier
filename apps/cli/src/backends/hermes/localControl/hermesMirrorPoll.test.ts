import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { openSqliteDatabaseSync, type SqliteStatementSync } from '@/daemon/memory/sqliteSync';
import { openHermesSessionStore } from '@/backends/hermes/localControl/hermesSessionStore';
import { pollHermesMirrorOnce } from '@/backends/hermes/localControl/hermesMirrorPoll';
import type { HermesMirrorAction } from '@/backends/hermes/localControl/hermesSessionRowMapping';

let dir: string;
let dbPath: string;
let insert: (sessionId: string, role: string, content: string | null, toolCalls: string | null, active: number) => void;
let writeDbClose: () => void;
let insertStmt: SqliteStatementSync;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'hh-hermes-poll-'));
  dbPath = join(dir, 'state.db');
  const db = openSqliteDatabaseSync(dbPath);
  db.exec(`CREATE TABLE messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, role TEXT NOT NULL,
    content TEXT, tool_call_id TEXT, tool_calls TEXT, tool_name TEXT, timestamp REAL NOT NULL,
    reasoning TEXT, active INTEGER NOT NULL DEFAULT 1)`);
  insertStmt = db.prepare(
    `INSERT INTO messages (session_id, role, content, tool_calls, timestamp, active) VALUES (?, ?, ?, ?, ?, ?)`,
  );
  let t = 0;
  insert = (sessionId, role, content, toolCalls, active) => {
    t += 1;
    insertStmt.run(sessionId, role, content, toolCalls, t, active);
  };
  writeDbClose = () => db.close();
  insert('S1', 'user', 'hello', null, 1);
  insert('S1', 'assistant', 'hi back', null, 1);
});

afterAll(() => {
  writeDbClose();
  rmSync(dir, { recursive: true, force: true });
});

describe('pollHermesMirrorOnce', () => {
  it('emits mapped actions for new rows in order and returns the advanced cursor', () => {
    const db = openHermesSessionStore(dbPath);
    const emitted: HermesMirrorAction[] = [];
    try {
      const cursor = pollHermesMirrorOnce({ db, sessionId: 'S1', cursor: 0, emit: (a) => emitted.push(a) });
      expect(emitted).toEqual([
        { kind: 'user-text', text: 'hello' },
        { kind: 'assistant-text', text: 'hi back' },
      ]);
      expect(cursor).toBe(2);
    } finally {
      db.close();
    }
  });

  it('emits nothing when re-polled at the current cursor', () => {
    const db = openHermesSessionStore(dbPath);
    const emitted: HermesMirrorAction[] = [];
    try {
      const cursor = pollHermesMirrorOnce({ db, sessionId: 'S1', cursor: 2, emit: (a) => emitted.push(a) });
      expect(emitted).toEqual([]);
      expect(cursor).toBe(2);
    } finally {
      db.close();
    }
  });

  it('tails only newly-appended rows and advances past inactive rows', () => {
    insert('S1', 'assistant', 'superseded', null, 0); // id 3, inactive -> no action, but cursor advances
    insert('S1', 'user', 'next question', null, 1); // id 4
    const db = openHermesSessionStore(dbPath);
    const emitted: HermesMirrorAction[] = [];
    try {
      const cursor = pollHermesMirrorOnce({ db, sessionId: 'S1', cursor: 2, emit: (a) => emitted.push(a) });
      expect(emitted).toEqual([{ kind: 'user-text', text: 'next question' }]);
      expect(cursor).toBe(4);
    } finally {
      db.close();
    }
  });
});
