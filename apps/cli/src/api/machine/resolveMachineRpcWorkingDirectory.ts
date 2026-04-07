import { homedir as osHomedir } from 'node:os';
import { isAbsolute, resolve } from 'node:path';

import { expandHomeDirPath } from '@happier-dev/cli-common/providers';

type Deps = Readonly<{
  env: NodeJS.ProcessEnv;
  homedir: () => string;
  cwd: () => string;
}>;

/**
 * Machine/daemon RPC handlers (filesystem + SCM) need a stable working directory root.
 *
 * We default to the user's home directory so multi-repo workflows work even when the daemon
 * is started from an arbitrary cwd.
 *
 * Override via `HAPPIER_MACHINE_RPC_WORKING_DIRECTORY` for tighter or custom scoping.
 */
export function resolveMachineRpcWorkingDirectory(overrides?: Partial<Deps>): string {
  const env = overrides?.env ?? process.env;
  const cwd = overrides?.cwd ?? process.cwd;
  const fallbackHomedir = overrides?.homedir ?? osHomedir;

  const explicit = expandHomeDirPath(String(env.HAPPIER_MACHINE_RPC_WORKING_DIRECTORY ?? '').trim(), env);
  const envHomeRaw = process.platform === 'win32'
    ? (env.USERPROFILE || env.HOME)
    : env.HOME;
  const envHomeDir = typeof envHomeRaw === 'string' ? envHomeRaw.trim() : '';
  const candidates = [explicit || null, envHomeDir || fallbackHomedir(), cwd()];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const value = String(candidate).trim();
    if (!value) continue;
    if (!isAbsolute(value)) continue;
    return resolve(value);
  }

  return resolve(cwd());
}
