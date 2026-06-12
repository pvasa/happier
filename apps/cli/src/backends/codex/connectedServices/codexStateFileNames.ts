import { resolve } from 'node:path';

import { resolveConfiguredCodexHome } from '@/backends/codex/utils/resolveConfiguredCodexHome';
import { expandHomeDirPath } from '@/utils/path/expandHomeDirPath';

// Shareable Codex SQLite state: `state_*`, `goals_*`, AND `logs_*` (plus their wal/shm
// sidecars; `-journal` excluded). `logs_*` inclusion deliberately supersedes the earlier
// Layer-B state-sharing plan exclusion: shared-state homes need the complete per-account
// SQLite set for cross-home session continuity, and the privacy surface is covered by the
// descriptor's `sharedStatePrivacyRiskAcknowledgementRequired` opt-in.
const CODEX_SHAREABLE_SQLITE_STATE_ENTRY_PATTERN = /^(?:state|goals|logs)_\d+\.sqlite(?:-(?:wal|shm))?$/;

export function isCodexShareableSqliteStateEntry(entryName: string): boolean {
  return CODEX_SHAREABLE_SQLITE_STATE_ENTRY_PATTERN.test(entryName);
}

export function resolveConfiguredCodexSqliteHome(
  processEnv: NodeJS.ProcessEnv,
  cwd = process.cwd(),
): string {
  const raw = processEnv.CODEX_SQLITE_HOME;
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  if (!trimmed) return resolveConfiguredCodexHome(processEnv);
  return resolve(cwd, expandHomeDirPath(trimmed, processEnv));
}
