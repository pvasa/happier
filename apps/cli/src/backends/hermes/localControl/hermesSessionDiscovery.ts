/**
 * Discovers the Hermes session id created by a freshly-spawned `hermes chat`
 * when Happier did not pre-assign one (a new local session). Hermes generates
 * the id and writes a `sessions` row; we pick the newest row started at or
 * after the launch instant, then persist + mirror that id.
 */
import type { SqliteDatabaseSync } from '@/daemon/memory/sqliteSync';

export function discoverHermesSessionIdSince(
  db: SqliteDatabaseSync,
  sinceEpochSeconds: number,
): string | null {
  const row = db
    .prepare('SELECT id FROM sessions WHERE started_at >= ? ORDER BY started_at DESC LIMIT 1')
    .get(sinceEpochSeconds) as { id?: unknown } | undefined;
  return row && typeof row.id === 'string' ? row.id : null;
}
