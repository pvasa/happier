/**
 * Resolves the path to Hermes's `state.db` (the SQLite session store the mirror
 * tails). Defaults to `<home>/.hermes/state.db`, honoring `HERMES_HOME` and an
 * explicit `HAPPIER_HERMES_STATE_DB` override. There is no existing constant for
 * this in the CLI, so the mirror/launcher resolve it here.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';

import { expandHomeDirPath } from '@/utils/path/expandHomeDirPath';

export function resolveHermesStateDbPath(params?: Readonly<{
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
}>): string {
  const env = params?.env ?? process.env;
  const homeDir = params?.homeDir ?? homedir();
  const expandEnv: NodeJS.ProcessEnv = { ...env, HOME: homeDir };

  const override = env.HAPPIER_HERMES_STATE_DB?.trim();
  if (override) {
    return expandHomeDirPath(override, expandEnv);
  }

  const hermesHome = env.HERMES_HOME?.trim();
  if (hermesHome) {
    return join(expandHomeDirPath(hermesHome, expandEnv), 'state.db');
  }

  return join(homeDir, '.hermes', 'state.db');
}
