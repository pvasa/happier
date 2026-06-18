/**
 * Read-only access to Hermes's `state.db` (SQLite, WAL) for mirroring a native
 * `hermes chat` session into the synced Happier transcript while the user
 * drives Hermes on the host.
 *
 * Hermes assigns each message a monotonic AUTOINCREMENT `id`, so the mirror
 * tails by `id` cursor (no timestamp ties). The store is opened read-only —
 * the mirror observes Hermes's data and must never mutate it.
 */
import { openSqliteDatabaseSync, type SqliteDatabaseSync } from '@/daemon/memory/sqliteSync';

import type { HermesSessionRow } from './hermesSessionRowMapping';

export function openHermesSessionStore(stateDbPath: string): SqliteDatabaseSync {
  return openSqliteDatabaseSync(stateDbPath, { readOnly: true });
}

const SELECT_ROWS_SINCE =
  'SELECT id, role, content, tool_calls AS toolCalls, tool_call_id AS toolCallId, '
  + 'tool_name AS toolName, reasoning, active '
  + 'FROM messages WHERE session_id = ? AND id > ? ORDER BY id ASC';

export function readHermesSessionRowsSince(
  db: SqliteDatabaseSync,
  sessionId: string,
  afterId: number,
): HermesSessionRow[] {
  const raw = db.prepare(SELECT_ROWS_SINCE).all(sessionId, afterId) as ReadonlyArray<Record<string, unknown>>;
  const rows: HermesSessionRow[] = [];
  for (const entry of raw) {
    const row = toHermesSessionRow(entry);
    if (row) rows.push(row);
  }
  return rows;
}

function toHermesSessionRow(raw: Record<string, unknown>): HermesSessionRow | null {
  const role = raw.role;
  if (role !== 'user' && role !== 'assistant' && role !== 'tool') return null;
  const id = typeof raw.id === 'number' ? raw.id : Number(raw.id);
  if (!Number.isFinite(id)) return null;
  return {
    id,
    role,
    content: asNullableString(raw.content),
    toolCalls: asNullableString(raw.toolCalls),
    toolCallId: asNullableString(raw.toolCallId),
    toolName: asNullableString(raw.toolName),
    reasoning: asNullableString(raw.reasoning),
    active: raw.active !== 0 && raw.active !== null && raw.active !== undefined,
  };
}

function asNullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}
