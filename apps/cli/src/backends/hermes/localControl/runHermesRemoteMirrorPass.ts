/**
 * Hermes remote-mode pass: the phone drives the session (the daemon-spawned
 * `hermes acp` runtime executes the agent), and the host stays alive showing a
 * READ-ONLY mirror. We tail the same state.db rows into the provided message
 * buffer (which the read-only RemoteControlDisplay renders) and wait for a
 * switch-to-local or exit request. No agent runtime runs here — the host never
 * attaches a second runtime, so there is no session-attach-secret requirement.
 */
import type { MessageBuffer } from '@/ui/ink/messageBuffer';

import { createHermesMessageBufferMirrorSink } from './createHermesMessageBufferMirrorSink';
import { createHermesSessionMirror, type HermesSessionMirror } from './createHermesSessionMirror';

export type HermesRemoteMirrorPassResult = 'switch' | 'exit';

export async function runHermesRemoteMirrorPass(params: Readonly<{
  stateDbPath: string;
  hermesSessionId: string | null;
  messageBuffer: MessageBuffer;
  armSwitchToLocal: (requestSwitch: () => void) => void;
  armExit: (requestExit: () => void) => void;
}>): Promise<HermesRemoteMirrorPassResult> {
  const { stateDbPath, hermesSessionId, messageBuffer } = params;

  messageBuffer.clear();
  let mirror: HermesSessionMirror | null = null;
  if (hermesSessionId) {
    const sink = createHermesMessageBufferMirrorSink(messageBuffer);
    mirror = createHermesSessionMirror({ stateDbPath, sessionId: hermesSessionId, sink });
    mirror.start();
  }

  const outcome = await new Promise<HermesRemoteMirrorPassResult>((resolve) => {
    params.armSwitchToLocal(() => resolve('switch'));
    params.armExit(() => resolve('exit'));
  });

  mirror?.stop();
  return outcome;
}
