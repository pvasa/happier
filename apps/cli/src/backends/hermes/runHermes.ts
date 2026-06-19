/**
 * Hermes CLI Entry Point
 *
 * Runs the Nous Research Hermes agent through Happier CLI. Two modes, with a
 * bidirectional control handoff:
 *  - local  (default on a foreground TTY): the native `hermes chat` TUI on the
 *           host, mirrored to the phone (see runHermesLocalSession).
 *  - remote (daemon / no TTY / forced): the `hermes acp` ACP backend via
 *           runStandardAcpProvider; drive from the phone, read-only host mirror.
 *
 * The phone can switch control either way. local->remote: the local session
 * tears down the TUI and returns a switch result; we continue the SAME session
 * over the remote ACP path. remote->local: runStandardAcpProvider's opt-in
 * onSwitchToLocal handler tears the remote run down and returns
 * `switch-to-local`, and we re-spawn the native TUI resuming the same Hermes
 * session (`hermes chat --resume <id>`). Session continuity is the persisted
 * hermesSessionId (state.db-backed, same id-space as `--resume`).
 */
import type { PermissionMode } from '@/api/types';
import { logger } from '@/ui/logger';
import type { Credentials } from '@/persistence';
import type { ApiSessionClient } from '@/api/session/sessionClient';
import { initialMachineMetadata } from '@/daemon/startDaemon';
import {
  runStandardAcpProvider,
  type StandardAcpProviderConfig,
  type StandardAcpProviderRunOptions,
} from '@/agent/runtime/runStandardAcpProvider';

import { HermesTerminalDisplay } from '@/backends/hermes/ui/HermesTerminalDisplay';
import { createHermesAcpRuntime } from '@/backends/hermes/acp/runtime';
import { resolveHermesStartingMode } from '@/backends/hermes/localControl/resolveHermesStartingMode';
import { runHermesLocalSession } from '@/backends/hermes/localControl/runHermesLocalSession';

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
  let mode: 'local' | 'remote' = resolveHermesStartingMode({
    explicit: opts.startingMode,
    startedBy: opts.startedBy,
    hasTTY: Boolean(process.stdin.isTTY && process.stdout.isTTY),
    forceRemote: readHermesForceRemote(process.env),
  });

  let existingSessionId = opts.existingSessionId;
  let resumeId = opts.resume;

  for (;;) {
    if (mode === 'local') {
      const result = await runHermesLocalSession({ ...opts, existingSessionId, resume: resumeId });
      if (result.type === 'switch') {
        // Phone took control -> continue the SAME session over remote ACP.
        mode = 'remote';
        existingSessionId = result.happierSessionId;
        resumeId = result.hermesSessionId ?? resumeId;
        continue;
      }
      // The live relay/session connection keeps the event loop alive, so a plain
      // return hangs the CLI after the TUI exits. Exit explicitly.
      process.exit(result.code);
    }

    // remote
    const switchSessionHolder: { current: ApiSessionClient | null } = { current: null };
    const config = hermesAcpConfig();
    config.onSwitchToLocal = ({ session }) => {
      switchSessionHolder.current = session;
    };
    const result = await runStandardAcpProvider({ ...opts, existingSessionId, resume: resumeId }, config);
    if (result?.type === 'switch-to-local') {
      // Phone handed control back to the host -> re-spawn the native TUI resuming
      // the same Hermes session.
      mode = 'local';
      existingSessionId = switchSessionHolder.current?.sessionId ?? existingSessionId;
      resumeId = switchSessionHolder.current?.getMetadataSnapshot()?.hermesSessionId ?? resumeId;
      continue;
    }
    return; // remote owns its own termination/exit otherwise
  }
}
