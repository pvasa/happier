import { resolve } from 'node:path';

import { resolveConfiguredCodexHome } from '@/backends/codex/utils/resolveConfiguredCodexHome';
import { expandHomeDirPath } from '@/utils/path/expandHomeDirPath';

const CODEX_SHAREABLE_SQLITE_STATE_ENTRY_PATTERN = /^(?:state|goals|logs)_\d+\.sqlite(?:-(?:wal|shm))?$/;

export function isCodexShareableSqliteStateEntry(entryName: string): boolean {
  return CODEX_SHAREABLE_SQLITE_STATE_ENTRY_PATTERN.test(entryName);
}

export function isCodexSharedStateSqliteFileName(entryName: string): boolean {
  return isCodexShareableSqliteStateEntry(entryName);
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
