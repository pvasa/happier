/**
 * Hermes CLI Entry Point
 *
 * Runs the Nous Research Hermes agent through Happier CLI. Two modes:
 *  - local  (default on a foreground TTY): the native `hermes chat` TUI on the
 *           host, mirrored to the phone (see runHermesLocalSession).
 *  - remote (daemon / no TTY / forced): the `hermes acp` ACP backend via
 *           runStandardAcpProvider; drive from the phone, read-only host mirror.
 */
import type { PermissionMode } from '@/api/types';
import { logger } from '@/ui/logger';
import type { Credentials } from '@/persistence';
import { initialMachineMetadata } from '@/daemon/startDaemon';
import { runStandardAcpProvider, type StandardAcpProviderRunOptions } from '@/agent/runtime/runStandardAcpProvider';

import { HermesTerminalDisplay } from '@/backends/hermes/ui/HermesTerminalDisplay';
import { createHermesAcpRuntime } from '@/backends/hermes/acp/runtime';
import { resolveHermesStartingMode } from '@/backends/hermes/localControl/resolveHermesStartingMode';
import { runHermesLocalSession } from '@/backends/hermes/localControl/runHermesLocalSession';

function readHermesForceRemote(env: NodeJS.ProcessEnv): boolean {
  const raw = (env.HAPPIER_HERMES_FORCE_REMOTE ?? '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

export async function runHermes(opts: StandardAcpProviderRunOptions & {
  credentials: Credentials;
  permissionMode?: PermissionMode;
  startingMode?: 'local' | 'remote';
}): Promise<void> {
  const startingMode = resolveHermesStartingMode({
    explicit: opts.startingMode,
    startedBy: opts.startedBy,
    hasTTY: Boolean(process.stdin.isTTY && process.stdout.isTTY),
    forceRemote: readHermesForceRemote(process.env),
  });

  if (startingMode === 'local') {
    const code = await runHermesLocalSession(opts);
    process.exitCode = code;
    return;
  }

  await runStandardAcpProvider(opts, {
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
  });
}
