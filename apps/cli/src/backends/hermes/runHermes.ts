/**
 * Hermes CLI entry point. Two start modes:
 *  - terminal (foreground TTY): one host-owned session that runs the native
 *    `hermes chat` TUI in local mode and a read-only mirror in remote mode (the
 *    phone drives via the daemon-spawned `hermes acp`). See
 *    runHermesTerminalControlSession.
 *  - daemon / no-TTY / forced remote: the `hermes acp` ACP runtime via
 *    runStandardAcpProvider — this is the daemon's legitimate remote runtime
 *    (it holds the per-session attach secret).
 */
import type { PermissionMode } from '@/api/types';
import type { Credentials } from '@/persistence';
import {
  runStandardAcpProvider,
  type StandardAcpProviderRunOptions,
} from '@/agent/runtime/runStandardAcpProvider';

import { createHermesAcpProviderConfig } from '@/backends/hermes/createHermesAcpProviderConfig';
import { resolveHermesStartingMode } from '@/backends/hermes/localControl/resolveHermesStartingMode';
import { runHermesTerminalControlSession } from '@/backends/hermes/localControl/runHermesTerminalControlSession';

function readHermesForceRemote(env: NodeJS.ProcessEnv): boolean {
  const raw = (env.HAPPIER_HERMES_FORCE_REMOTE ?? '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

export async function runHermes(opts: StandardAcpProviderRunOptions & {
  credentials: Credentials;
  permissionMode?: PermissionMode;
  startingMode?: 'local' | 'remote';
}): Promise<void> {
  const hasTTY = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  const startingMode = resolveHermesStartingMode({
    explicit: opts.startingMode,
    startedBy: opts.startedBy,
    hasTTY,
    forceRemote: readHermesForceRemote(process.env),
  });

  if (startingMode === 'remote') {
    // Daemon-owned remote runtime (holds the per-session attach secret).
    await runStandardAcpProvider({ ...opts }, createHermesAcpProviderConfig());
    return;
  }

  await runHermesTerminalControlSession(opts, hasTTY);
}
