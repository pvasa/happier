/**
 * Terminal-started Hermes host: ONE long-lived process owning ONE host-owned
 * Happier session for the whole local<->remote lifecycle (mirrors codex's
 * single-session loop). Because the session is created once via the canonical
 * bootstrap and never re-attached, mode flips never call
 * createBaseSessionForAttach and so never need a per-session attach secret (the
 * old bespoke loop did, which is why a host switch-to-remote threw "missing
 * session attach secret").
 *
 *  - local  : native `hermes chat` TUI, mirrored to the phone.
 *  - remote : read-only mirror — the daemon-spawned `hermes acp` runtime drives
 *             for the phone while the host shows the conversation read-only.
 *
 * Mode flips only swap the UI surface (via createLocalRemoteModeController). A
 * single bidirectional `switch` RPC handler routes phone requests to the active
 * mode's trigger.
 */
import { randomUUID } from 'node:crypto';

import type { ApiSessionClient } from '@/api/session/sessionClient';
import type { Credentials } from '@/persistence';
import type { PermissionMode } from '@/api/types';
import { initialMachineMetadata } from '@/daemon/startDaemon';
import { initializeBackendApiContext } from '@/agent/runtime/initializeBackendApiContext';
import { createSessionMetadata } from '@/agent/runtime/createSessionMetadata';
import { createStartupMetadataOverrides } from '@/agent/runtime/createStartupMetadataOverrides';
import { initializeBackendRunSession } from '@/agent/runtime/initializeBackendRunSession';
import { resolveSwitchRequestTarget } from '@/agent/localControl/switchRequestTarget';
import { createLocalRemoteModeController } from '@/agent/localControl/createLocalRemoteModeController';
import { MessageBuffer } from '@/ui/ink/messageBuffer';
import type { StandardAcpProviderRunOptions } from '@/agent/runtime/runStandardAcpProvider';

import { createHermesChatSpawner } from './createHermesChatSpawner';
import { createHermesRemoteTerminalUi } from './createHermesRemoteTerminalUi';
import { resolveHermesStateDbPath } from './resolveHermesStateDbPath';
import { hermesModeLoop } from './hermesModeLoop';
import { runHermesLocalChatPass } from './runHermesLocalChatPass';
import { runHermesRemoteMirrorPass } from './runHermesRemoteMirrorPass';

const LOG_PREFIX = '[hermes]';
const HANDOFF_FLUSH_GRACE_MS = 150;

export type RunHermesTerminalControlSessionOptions = StandardAcpProviderRunOptions & {
  credentials: Credentials;
  permissionMode?: PermissionMode;
};

export async function runHermesTerminalControlSession(
  opts: RunHermesTerminalControlSessionOptions,
  hasTTY: boolean,
): Promise<void> {
  const { api, machineId } = await initializeBackendApiContext({
    credentials: opts.credentials,
    machineMetadata: initialMachineMetadata,
  });

  const { state, metadata } = createSessionMetadata({
    flavor: 'hermes',
    acpProviderId: 'hermes',
    machineId,
    startedBy: opts.startedBy,
    terminalRuntime: opts.terminalRuntime ?? null,
    permissionMode: opts.permissionMode,
    permissionModeUpdatedAt: opts.permissionModeUpdatedAt,
    agentModeId: opts.agentModeId,
    agentModeUpdatedAt: opts.agentModeUpdatedAt,
    modelId: opts.modelId,
    modelUpdatedAt: opts.modelUpdatedAt,
  });

  let session: ApiSessionClient;
  const initialized = await initializeBackendRunSession({
    api,
    sessionTag: randomUUID(),
    metadata,
    state,
    existingSessionId: opts.existingSessionId,
    uiLogPrefix: LOG_PREFIX,
    startupMetadataOverrides: createStartupMetadataOverrides(opts),
    onSessionSwap: (newSession) => {
      session = newSession;
    },
  });
  session = initialized.session;
  const reconnectionHandle = initialized.reconnectionHandle;

  const stateDbPath = resolveHermesStateDbPath();
  const spawnChat = createHermesChatSpawner({
    cwd: session.getMetadataSnapshot()?.path ?? process.cwd(),
  });
  const messageBuffer = new MessageBuffer();

  // Per-pass switch/exit triggers, routed by the single bidirectional handler.
  const armed: {
    toRemote: (() => void) | null;
    toLocal: (() => void) | null;
    exit: (() => void) | null;
  } = { toRemote: null, toLocal: null, exit: null };
  let mode: 'local' | 'remote' = 'local';

  const remoteUi = createHermesRemoteTerminalUi({
    messageBuffer,
    hasTTY,
    stdin: process.stdin,
    onExit: async () => {
      armed.exit?.();
    },
    onSwitchToLocal: async () => {
      armed.toLocal?.();
    },
  });

  const controller = createLocalRemoteModeController({
    session,
    getThinking: () => false,
    resolveLocalSwitchAvailability: async () => ({ ok: true }),
    requestSwitchToLocalIfSupported: async () => {
      armed.toLocal?.();
      return true;
    },
    mountRemoteUi: () => remoteUi.mount(),
    unmountRemoteUi: () => remoteUi.unmount(),
    setRemoteUiAllowsSwitchToLocal: (allowed) => remoteUi.setAllowSwitchToLocal(allowed),
  });

  session.rpcHandlerManager.registerHandler('switch', async (requestParams: unknown) => {
    const to = resolveSwitchRequestTarget(requestParams);
    if (mode === 'local' && to === 'remote') {
      armed.toRemote?.();
      return true;
    }
    if (mode === 'remote' && to === 'local') {
      armed.toLocal?.();
      return true;
    }
    return true;
  });

  const resumeIdHolder: { current: string | null } = {
    current: opts.resume ?? session.getMetadataSnapshot()?.hermesSessionId ?? null,
  };

  const code = await hermesModeLoop({
    startingMode: 'local',
    onModeChange: (next) => {
      mode = next;
    },
    session: { keepAlive: () => {} },
    runLocal: async () => {
      await controller.publishModeState('local');
      const result = await runHermesLocalChatPass({
        session,
        stateDbPath,
        knownHermesSessionId: resumeIdHolder.current,
        spawnChat,
        armSwitchToRemote: (trigger) => {
          armed.toRemote = trigger;
        },
      });
      if (result.type === 'switch') {
        resumeIdHolder.current = result.hermesSessionId ?? resumeIdHolder.current;
        return { type: 'switch', resumeId: resumeIdHolder.current ?? '' };
      }
      return { type: 'exit', code: result.code };
    },
    runRemote: async () => {
      await controller.publishModeState('remote');
      return runHermesRemoteMirrorPass({
        stateDbPath,
        hermesSessionId: resumeIdHolder.current,
        messageBuffer,
        armSwitchToLocal: (trigger) => {
          armed.toLocal = trigger;
        },
        armExit: (trigger) => {
          armed.exit = trigger;
        },
      });
    },
  });

  await remoteUi.unmount();
  reconnectionHandle?.cancel();
  // Let best-effort mode/transcript writes flush over the relay before exit.
  await new Promise((resolve) => setTimeout(resolve, HANDOFF_FLUSH_GRACE_MS));
  process.exit(code);
}
