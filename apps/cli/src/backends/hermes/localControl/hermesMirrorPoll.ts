/**
 * One tail step of the Hermes session mirror: read rows appended since the
 * cursor, emit their mapped mirror actions, and return the advanced cursor.
 *
 * The cursor advances past every row read — including inactive/superseded rows
 * that map to no actions — so a row is never re-evaluated. Kept pure (db + emit
 * injected) so the tail/cursor behavior is tested directly against SQLite.
 */
import type { SqliteDatabaseSync } from '@/daemon/memory/sqliteSync';

import { mapHermesSessionRow, type HermesMirrorAction } from './hermesSessionRowMapping';
import { readHermesSessionRowsSince } from './hermesSessionStore';

export function pollHermesMirrorOnce(params: Readonly<{
  db: SqliteDatabaseSync;
  sessionId: string;
  cursor: number;
  emit: (action: HermesMirrorAction) => void;
}>): number {
  const rows = readHermesSessionRowsSince(params.db, params.sessionId, params.cursor);
  let next = params.cursor;
  for (const row of rows) {
    for (const action of mapHermesSessionRow(row)) {
      params.emit(action);
    }
    if (row.id > next) next = row.id;
  }
  return next;
}
