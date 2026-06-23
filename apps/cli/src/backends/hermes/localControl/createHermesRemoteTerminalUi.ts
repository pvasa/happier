/**
 * Mounts/unmounts the host's read-only Hermes remote-mode terminal UI. While the
 * phone drives the session, the host shows the conversation read-only (no input
 * composer) with a "switch to local" affordance. Mirrors
 * createCodexRemoteTerminalUi; the message buffer is fed by the state.db mirror
 * (see createHermesMessageBufferMirrorSink), not by an in-process runtime.
 */
import { render } from 'ink';
import React from 'react';

import { cleanupStdinAfterInk } from '@/ui/ink/cleanupStdinAfterInk';
import { MessageBuffer } from '@/ui/ink/messageBuffer';
import { createNonBlockingStdout } from '@/ui/ink/nonBlockingStdout';
import {
  startRemoteModeStaticControl,
  type RemoteModeControlSurface,
  type RemoteModeStaticControl,
} from '@/ui/remoteControl/remoteModeControl';
import { HermesRemoteTerminalDisplay } from '@/backends/hermes/ui/HermesRemoteTerminalDisplay';

export type HermesRemoteTerminalUi = Readonly<{
  mount: () => void;
  unmount: () => Promise<void>;
  setAllowSwitchToLocal: (allowed: boolean) => void;
}>;

export function createHermesRemoteTerminalUi(params: {
  messageBuffer: MessageBuffer;
  logPath?: string;
  hasTTY: boolean;
  surface?: RemoteModeControlSurface;
  stdin: NodeJS.ReadStream;
  stdout?: NodeJS.WriteStream;
  onExit: () => Promise<void>;
  onSwitchToLocal: () => Promise<void>;
}): HermesRemoteTerminalUi {
  let inkInstance: ReturnType<typeof render> | null = null;
  let staticControl: RemoteModeStaticControl | null = null;
  let allowSwitchToLocal = false;
  const surface: RemoteModeControlSurface = params.surface ?? (params.hasTTY ? 'ink' : 'none');

  const renderRemoteUi = () => React.createElement(HermesRemoteTerminalDisplay, {
    messageBuffer: params.messageBuffer,
    logPath: params.logPath,
    allowSwitchToLocal,
    onExit: params.onExit,
    onSwitchToLocal: params.onSwitchToLocal,
  });

  const startStatic = () => startRemoteModeStaticControl({
    providerName: 'Hermes',
    stdin: params.stdin,
    stdout: params.stdout ?? process.stdout,
    allowSwitchToLocal,
    onExit: params.onExit,
    onSwitchToLocal: params.onSwitchToLocal,
  });

  const mount = () => {
    if (surface === 'static') {
      if (!staticControl) staticControl = startStatic();
      return;
    }
    if (surface !== 'ink' || !params.hasTTY) return;
    if (!inkInstance) {
      console.clear();
      inkInstance = render(renderRemoteUi(), {
        exitOnCtrlC: false,
        patchConsole: false,
        stdout: createNonBlockingStdout(process.stdout as NodeJS.WriteStream),
      });
      params.stdin.resume();
      if (params.stdin.isTTY) params.stdin.setRawMode(true);
      params.stdin.setEncoding('utf8');
      return;
    }
    inkInstance.rerender(renderRemoteUi());
  };

  const unmount = async () => {
    if (staticControl) {
      await staticControl.stop();
      staticControl = null;
    }
    if (surface !== 'ink' || !params.hasTTY) return;
    if (params.stdin.isTTY) {
      try {
        params.stdin.setRawMode(false);
      } catch {
        // ignore
      }
    }
    if (inkInstance) {
      try {
        inkInstance.unmount();
      } catch {
        // ignore
      }
      inkInstance = null;
    }
    await cleanupStdinAfterInk({ stdin: params.stdin, drainMs: 75 });
    try {
      params.stdin.pause();
    } catch {
      // ignore
    }
  };

  const setAllowSwitchToLocal = (allowed: boolean) => {
    allowSwitchToLocal = allowed;
    if (staticControl) {
      void staticControl.stop();
      staticControl = startStatic();
    }
    if (inkInstance) inkInstance.rerender(renderRemoteUi());
  };

  return { mount, unmount, setAllowSwitchToLocal };
}
