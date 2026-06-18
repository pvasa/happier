/**
 * Runs the Hermes session mirror: on an interval, tail `state.db` for new rows
 * of the active session and replay them into the Happier transcript via the
 * sink. The read-only store is reopened per poll so the mirror never holds a
 * handle on Hermes's live database and always observes the latest commit.
 */
import type { SqliteDatabaseSync } from '@/daemon/memory/sqliteSync';

import { applyHermesMirrorAction, type HermesMirrorSink } from './hermesMirrorSink';
import { pollHermesMirrorOnce } from './hermesMirrorPoll';
import { openHermesSessionStore } from './hermesSessionStore';

const DEFAULT_POLL_INTERVAL_MS = 400;

export type HermesSessionMirror = Readonly<{
  start: () => void;
  stop: () => void;
  pollNow: () => void;
}>;

export function createHermesSessionMirror(params: Readonly<{
  stateDbPath: string;
  sessionId: string;
  sink: HermesMirrorSink;
  pollIntervalMs?: number;
  openStore?: (path: string) => SqliteDatabaseSync;
  onError?: (error: unknown) => void;
}>): HermesSessionMirror {
  const openStore = params.openStore ?? openHermesSessionStore;
  const intervalMs = params.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  let cursor = 0;
  let timer: ReturnType<typeof setInterval> | null = null;

  const step = (): void => {
    let db: SqliteDatabaseSync | null = null;
    try {
      db = openStore(params.stateDbPath);
      cursor = pollHermesMirrorOnce({
        db,
        sessionId: params.sessionId,
        cursor,
        emit: (action) => applyHermesMirrorAction(params.sink, action),
      });
    } catch (error) {
      params.onError?.(error);
    } finally {
      try {
        db?.close();
      } catch {
        // A read-only handle failing to close must not break the mirror loop.
      }
    }
  };

  return {
    start: () => {
      if (timer) return;
      step();
      timer = setInterval(step, intervalMs);
      if (typeof timer.unref === 'function') timer.unref();
    },
    stop: () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
    pollNow: step,
  };
}
