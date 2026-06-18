/**
 * Hermes local mode (v1): run the native `hermes chat` TUI on the host with the
 * terminal attached, and mirror that session to the phone. Because Hermes is
 * server-less, local mode runs `hermes chat` INSTEAD of `hermes acp` (never
 * both on one state.db session).
 *
 * This reuses the canonical session-creation helpers (initializeBackendApiContext
 * / createSessionMetadata / initializeBackendRunSession) rather than duplicating
 * runStandardAcpProvider's bootstrap. v1 is local-only: when the TUI exits the
 * session ends. The bidirectional phone<->host handoff (hermesModeLoop +
 * hermesLocalLauncher + a runStandardAcpProvider teardown race) is phase 2.
 *
 * RUNTIME-UNVALIDATED: this orchestration is typecheck-clean but has not been
 * exercised against a live daemon/relay/TTY. Validate interactively (spec §11).
 */
import { randomUUID } from 'node:crypto';

import type { ApiSessionClient } from '@/api/session/sessionClient';
import { initialMachineMetadata } from '@/daemon/startDaemon';
import { initializeBackendApiContext } from '@/agent/runtime/initializeBackendApiContext';
import { createSessionMetadata } from '@/agent/runtime/createSessionMetadata';
import { createStartupMetadataOverrides } from '@/agent/runtime/createStartupMetadataOverrides';
import { initializeBackendRunSession } from '@/agent/runtime/initializeBackendRunSession';
import { updateAgentStateBestEffort, updateMetadataBestEffort } from '@/api/session/sessionWritesBestEffort';
import { logger } from '@/ui/logger';
import { resolveSwitchRequestTarget } from '@/agent/localControl/switchRequestTarget';
import type { StandardAcpProviderRunOptions } from '@/agent/runtime/runStandardAcpProvider';
import type { Credentials } from '@/persistence';
import type { PermissionMode } from '@/api/types';

import { buildHermesChatArgs } from './hermesChatInvocation';
import { createHermesChatSpawner } from './createHermesChatSpawner';
import { createHermesSessionMirror, type HermesSessionMirror } from './createHermesSessionMirror';
import { createHermesSessionMirrorSink } from './createHermesSessionMirrorSink';
import { resolveHermesStateDbPath } from './resolveHermesStateDbPath';
import { waitForHermesSessionId } from './waitForHermesSessionId';

const LOG_PREFIX = '[hermes]';
const SESSION_ID_WAIT_TIMEOUT_MS = 30_000;
const SESSION_ID_WAIT_INTERVAL_MS = 300;

export type RunHermesLocalSessionOptions = StandardAcpProviderRunOptions & {
  credentials: Credentials;
  permissionMode?: PermissionMode;
};

export type RunHermesLocalSessionResult =
  | { type: 'exit'; code: number }
  | { type: 'switch'; happierSessionId: string; hermesSessionId: string | null };

export async function runHermesLocalSession(opts: RunHermesLocalSessionOptions): Promise<RunHermesLocalSessionResult> {
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

  const publishMode = (mode: 'local' | 'remote', reason: string): void => {
    session.sendSessionEvent({ type: 'switch', mode });
    updateAgentStateBestEffort(
      session,
      (current) => ({ ...current, controlledByUser: mode === 'local' }),
      LOG_PREFIX,
      reason,
    );
    session.keepAlive(false, mode);
  };

  publishMode('local', 'hermes_local_session_start');

  const stateDbPath = resolveHermesStateDbPath();
  const directory = session.getMetadataSnapshot()?.path ?? process.cwd();
  const knownSessionId = session.getMetadataSnapshot()?.hermesSessionId ?? null;
  const sink = createHermesSessionMirrorSink({ session });
  const spawnChat = createHermesChatSpawner({ cwd: directory });
  const sinceEpochSeconds = Date.now() / 1000;

  const child = spawnChat(buildHermesChatArgs({ resumeSessionId: knownSessionId }));

  const resolvedHermesIdHolder: { current: string | null } = { current: knownSessionId };
  let switchToRemoteRequested = false;
  // The phone can move control to remote: tear down the host TUI so the SAME
  // session continues over ACP (the caller resumes it). Without this handler the
  // phone's switch request fails with 'Failed to switch control mode'.
  session.rpcHandlerManager.registerHandler('switch', async (requestParams: unknown) => {
    const to = resolveSwitchRequestTarget(requestParams);
    if (to === 'local') {
      return true;
    }
    switchToRemoteRequested = true;
    child.kill('SIGTERM');
    return true;
  });

  const mirrorHolder: { current: HermesSessionMirror | null } = { current: null };
  let stopped = false;

  // Resolve the Hermes session id (known on resume, discovered for a fresh
  // session once `hermes chat` writes it) and start the mirror in the background
  // so the spawned TUI is not blocked on it.
  void (async () => {
    const sessionId = knownSessionId
      ?? (await waitForHermesSessionId({
        stateDbPath,
        sinceEpochSeconds,
        timeoutMs: SESSION_ID_WAIT_TIMEOUT_MS,
        intervalMs: SESSION_ID_WAIT_INTERVAL_MS,
      }));
    if (!sessionId) {
      logger.debug(`${LOG_PREFIX} Could not resolve a Hermes session id to mirror (non-fatal)`);
      return;
    }
    resolvedHermesIdHolder.current = sessionId;
    if (!knownSessionId) {
      updateMetadataBestEffort(
        session,
        (current) => ({ ...current, hermesSessionId: sessionId }),
        LOG_PREFIX,
        'hermes_session_id_publish',
      );
    }
    if (stopped) {
      return;
    }
    const mirror = createHermesSessionMirror({ stateDbPath, sessionId, sink });
    mirrorHolder.current = mirror;
    mirror.start();
  })().catch((error) => {
    logger.debug(`${LOG_PREFIX} Failed to start Hermes session mirror (non-fatal)`, error);
  });

  const code = await new Promise<number>((resolve) => {
    child.onExit((exitCode) => resolve(exitCode ?? 0));
  });

  stopped = true;
  mirrorHolder.current?.stop();
  publishMode('remote', switchToRemoteRequested ? 'hermes_local_switch_to_remote' : 'hermes_local_session_exit');
  reconnectionHandle?.cancel();

  // Let the best-effort mode/transcript writes flush over the relay connection
  // before the caller exits or hands off to remote.
  await new Promise((resolve) => setTimeout(resolve, 150));

  if (switchToRemoteRequested) {
    return { type: 'switch', happierSessionId: session.sessionId, hermesSessionId: resolvedHermesIdHolder.current };
  }
  return { type: 'exit', code };
}
