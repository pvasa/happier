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
import { logger } from '@/ui/logger';
import type { Credentials } from '@/persistence';
import { initialMachineMetadata } from '@/daemon/startDaemon';
import {
  runStandardAcpProvider,
  type StandardAcpProviderConfig,
  type StandardAcpProviderRunOptions,
} from '@/agent/runtime/runStandardAcpProvider';

import { HermesTerminalDisplay } from '@/backends/hermes/ui/HermesTerminalDisplay';
import { createHermesAcpRuntime } from '@/backends/hermes/acp/runtime';
import { resolveHermesStartingMode } from '@/backends/hermes/localControl/resolveHermesStartingMode';
import { runHermesTerminalControlSession } from '@/backends/hermes/localControl/runHermesTerminalControlSession';

function readHermesForceRemote(env: NodeJS.ProcessEnv): boolean {
  const raw = (env.HAPPIER_HERMES_FORCE_REMOTE ?? '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

function hermesAcpConfig(): StandardAcpProviderConfig {
  return {
    flavor: 'hermes',
    backendDisplayName: 'Hermes',
    uiLogPrefix: '[Hermes]',
    providerName: 'Hermes',
    waitingForCommandLabel: 'Hermes',
    agentMessageType: 'hermes',
    machineMetadata: initialMachineMetadata,
    terminalDisplay: HermesTerminalDisplay,
    createRuntime: ({ directory, machineId, session, messageBuffer, mcpServers, permissionHandler, setThinking, getPermissionMode, memoryRecallGuidanceEnabled, pendingQueueDrainMaxPopPerWake }) => createHermesAcpRuntime({
      directory,
      machineId,
      session,
      messageBuffer,
      mcpServers,
      permissionHandler,
      onThinkingChange: setThinking,
      memoryRecallGuidanceEnabled,
      getPermissionMode,
      pendingQueueDrainMaxPopPerWake,
    }),
    onAttachMetadataSnapshotMissing: (error) => {
      logger.debug(
        '[hermes] Failed to fetch session metadata snapshot before attach startup update; continuing without metadata write (non-fatal)',
        error ?? undefined,
      );
    },
    formatPromptErrorMessage: (error) => `Error: ${error instanceof Error ? error.message : String(error)}`,
  };
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
    await runStandardAcpProvider({ ...opts }, hermesAcpConfig());
    return;
  }

  await runHermesTerminalControlSession(opts, hasTTY);
}
