import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { openSqliteDatabaseSync } from '@/daemon/memory/sqliteSync';
import { createHermesSessionMirror } from '@/backends/hermes/localControl/createHermesSessionMirror';
import { applyHermesMirrorAction, type HermesMirrorSink } from '@/backends/hermes/localControl/hermesMirrorSink';
import type { HermesMirrorAction } from '@/backends/hermes/localControl/hermesSessionRowMapping';

let dir: string;
let dbPath: string;
let seq = 0;
function insert(role: string, content: string): void {
  const db = openSqliteDatabaseSync(dbPath);
  seq += 1;
  db.prepare('INSERT INTO messages (session_id, role, content, timestamp, active) VALUES (?, ?, ?, ?, 1)').run(
    'S1', role, content, seq,
  );
  db.close();
}

function recordingSink(out: HermesMirrorAction[]): HermesMirrorSink {
  return {
    userText: (text) => out.push({ kind: 'user-text', text }),
    assistantText: (text) => out.push({ kind: 'assistant-text', text }),
    reasoning: (text) => out.push({ kind: 'reasoning', text }),
    toolCalls: (calls) => out.push({ kind: 'assistant-tool-calls', calls }),
    toolResult: (p) => out.push({ kind: 'tool-result', ...p }),
  };
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'hh-hermes-mirror-'));
  dbPath = join(dir, 'state.db');
  const db = openSqliteDatabaseSync(dbPath);
  db.exec(`CREATE TABLE messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, role TEXT NOT NULL,
    content TEXT, tool_call_id TEXT, tool_calls TEXT, tool_name TEXT, timestamp REAL NOT NULL,
    reasoning TEXT, active INTEGER NOT NULL DEFAULT 1)`);
  db.close();
  insert('user', 'first');
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('createHermesSessionMirror', () => {
  it('tails newly appended rows across successive polls (cursor persists)', () => {
    const out: HermesMirrorAction[] = [];
    const mirror = createHermesSessionMirror({ stateDbPath: dbPath, sessionId: 'S1', sink: recordingSink(out) });
    mirror.pollNow();
    expect(out).toEqual([{ kind: 'user-text', text: 'first' }]);
    insert('assistant', 'second');
    mirror.pollNow();
    expect(out).toEqual([
      { kind: 'user-text', text: 'first' },
      { kind: 'assistant-text', text: 'second' },
    ]);
  });

  it('polls immediately on start and on each interval, and halts on stop', () => {
    vi.useFakeTimers();
    const out: HermesMirrorAction[] = [];
    const mirror = createHermesSessionMirror({
      stateDbPath: dbPath,
      sessionId: 'S1',
      sink: recordingSink(out),
      pollIntervalMs: 100,
    });
    mirror.start();
    const afterStart = out.length;
    expect(afterStart).toBeGreaterThan(0); // immediate poll drained existing rows
    insert('user', 'third');
    vi.advanceTimersByTime(100);
    expect(out.length).toBe(afterStart + 1);
    expect(out[out.length - 1]).toEqual({ kind: 'user-text', text: 'third' });
    mirror.stop();
    insert('user', 'ignored-after-stop');
    vi.advanceTimersByTime(500);
    expect(out[out.length - 1]).toEqual({ kind: 'user-text', text: 'third' });
  });

  it('routes through applyHermesMirrorAction for parity with the sink contract', () => {
    const out: HermesMirrorAction[] = [];
    const sink = recordingSink(out);
    applyHermesMirrorAction(sink, { kind: 'assistant-text', text: 'x' });
    expect(out).toEqual([{ kind: 'assistant-text', text: 'x' }]);
  });
});
