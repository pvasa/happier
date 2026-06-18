/**
 * Drives Hermes "local mode": spawns the native `hermes chat` TUI (the caller
 * attaches the host terminal via stdio:'inherit') and mirrors that session to
 * the phone while the user drives on the host. A phone-originated message hands
 * off to remote mode (Codex's model) — there is no live injection into the TUI:
 * we finish by tearing down the TUI and resuming the same session over ACP.
 *
 * Boundaries (spawn, session writes, the pending-message queue, the mirror
 * factory) are injected so the orchestration is tested with the real
 * turn-lifecycle + deferred-remote-switch controllers and no internal mocks.
 */
import {
  createDeferredRemoteSwitchController,
  createLocalTurnLifecycleController,
} from '@/agent/localControl/turnLifecycle';

import { createHermesSessionMirror, type HermesSessionMirror } from './createHermesSessionMirror';
import { createHermesSessionMirrorSink, type HermesMirrorSessionWriter } from './createHermesSessionMirrorSink';
import type { HermesMirrorSink } from './hermesMirrorSink';

export type HermesLauncherResult =
  | { type: 'switch'; resumeId: string | null }
  | { type: 'exit'; code: number };

export type HermesLauncherChild = Readonly<{
  onExit: (cb: (code: number | null) => void) => void;
  kill: (signal?: NodeJS.Signals) => void;
}>;

export type HermesLauncherMessageQueuePort = Readonly<{
  setOnMessage: (cb: ((message: string, mode: string) => void) | null) => void;
}>;

export type HermesLauncherModeControls = Readonly<{
  publishLocalMode: () => void;
  publishRemoteMode: () => void;
}>;

export type HermesLocalLauncherParams = Readonly<{
  sessionId: string;
  stateDbPath: string;
  chatArgs: readonly string[];
  spawnChat: (args: readonly string[]) => HermesLauncherChild;
  session: HermesMirrorSessionWriter;
  modeControls: HermesLauncherModeControls;
  messageQueue: HermesLauncherMessageQueuePort;
  createMirror?: (params: { stateDbPath: string; sessionId: string; sink: HermesMirrorSink }) => HermesSessionMirror;
  newId?: () => string;
}>;

export async function hermesLocalLauncher(params: HermesLocalLauncherParams): Promise<HermesLauncherResult> {
  const sink = createHermesSessionMirrorSink({ session: params.session, newId: params.newId });
  const mirror = (params.createMirror ?? createHermesSessionMirror)({
    stateDbPath: params.stateDbPath,
    sessionId: params.sessionId,
    sink,
  });

  const lifecycle = createLocalTurnLifecycleController({ completionQuiescenceMs: 0 });
  let switched = false;
  const child = params.spawnChat(params.chatArgs);

  const deferredSwitch = createDeferredRemoteSwitchController<string, string>({
    lifecycle,
    providerLabel: 'Hermes',
    requestSwitchToRemote: async () => {
      switched = true;
      child.kill('SIGTERM');
      return true;
    },
  });

  let resolveExit!: (code: number) => void;
  const exited = new Promise<number>((resolve) => {
    resolveExit = resolve;
  });
  child.onExit((code) => resolveExit(code ?? 0));
  params.messageQueue.setOnMessage((message, mode) => deferredSwitch.onQueuedMessage(message, mode));

  params.modeControls.publishLocalMode();
  mirror.start();

  const code = await exited;

  mirror.stop();
  params.messageQueue.setOnMessage(null);
  deferredSwitch.dispose();
  lifecycle.dispose();
  params.modeControls.publishRemoteMode();

  return switched ? { type: 'switch', resumeId: params.sessionId } : { type: 'exit', code };
}
