/**
 * Hermes local-mode pass on a SHARED, already-bootstrapped session: spawn the
 * native `hermes chat` TUI (host terminal attached) and mirror its state.db rows
 * into the Happier transcript. A phone "switch to remote" request kills the TUI
 * and ends the pass with the resolved Hermes session id so the caller can hand
 * off to the read-only remote mirror while the daemon drives. The session is
 * owned by the caller and is NOT created or torn down here.
 */
import type { ApiSessionClient } from '@/api/session/sessionClient';
import { updateMetadataBestEffort } from '@/api/session/sessionWritesBestEffort';
import { logger } from '@/ui/logger';

import { buildHermesChatArgs } from './hermesChatInvocation';
import { createHermesSessionMirror, type HermesSessionMirror } from './createHermesSessionMirror';
import { createHermesSessionMirrorSink } from './createHermesSessionMirrorSink';
import type { HermesLauncherChild } from './hermesLocalLauncher';
import { waitForHermesSessionId } from './waitForHermesSessionId';

const LOG_PREFIX = '[hermes]';
const SESSION_ID_WAIT_TIMEOUT_MS = 30_000;
const SESSION_ID_WAIT_INTERVAL_MS = 300;

export type HermesLocalChatPassResult =
  | { type: 'exit'; code: number }
  | { type: 'switch'; hermesSessionId: string | null };

export async function runHermesLocalChatPass(params: Readonly<{
  session: ApiSessionClient;
  stateDbPath: string;
  knownHermesSessionId: string | null;
  spawnChat: (args: readonly string[]) => HermesLauncherChild;
  armSwitchToRemote: (requestSwitch: () => void) => void;
}>): Promise<HermesLocalChatPassResult> {
  const { session, stateDbPath, knownHermesSessionId, spawnChat } = params;

  const sink = createHermesSessionMirrorSink({ session });
  const sinceEpochSeconds = Date.now() / 1000;
  const child = spawnChat(buildHermesChatArgs({ resumeSessionId: knownHermesSessionId }));

  const resolvedHermesIdHolder: { current: string | null } = { current: knownHermesSessionId };
  let switchToRemoteRequested = false;
  params.armSwitchToRemote(() => {
    switchToRemoteRequested = true;
    child.kill('SIGTERM');
  });

  const mirrorHolder: { current: HermesSessionMirror | null } = { current: null };
  let stopped = false;

  void (async () => {
    const sessionId = knownHermesSessionId
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
    if (!knownHermesSessionId) {
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

  if (switchToRemoteRequested) {
    return { type: 'switch', hermesSessionId: resolvedHermesIdHolder.current };
  }
  return { type: 'exit', code };
}
