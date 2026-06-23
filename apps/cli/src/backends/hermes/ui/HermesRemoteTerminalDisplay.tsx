/**
 * HermesRemoteTerminalDisplay
 *
 * Hermes remote-mode terminal display built on the shared read-only remote
 * control shell. Shown on the host while it runs the Hermes runtime in remote
 * mode and the phone drives the conversation. Read-only: no text composer, only
 * switch-to-local / exit affordances. Rendered from the in-process runtime's
 * MessageBuffer (the same buffer the runtime feeds), mirroring codex's read-only
 * RemoteControlDisplay surface.
 */
import React from 'react';

import { RemoteControlDisplay } from '@/ui/ink/RemoteControlDisplay';
import { MessageBuffer } from '@/ui/ink/messageBuffer';

export type HermesRemoteTerminalDisplayProps = {
  messageBuffer: MessageBuffer;
  logPath?: string;
  allowSwitchToLocal?: boolean;
  onExit?: () => void | Promise<void>;
  onSwitchToLocal?: () => void | Promise<void>;
};

export const HermesRemoteTerminalDisplay: React.FC<HermesRemoteTerminalDisplayProps> = ({
  messageBuffer,
  logPath,
  allowSwitchToLocal,
  onExit,
  onSwitchToLocal,
}) => {
  return (
    <RemoteControlDisplay
      providerName="Hermes"
      messageBuffer={messageBuffer}
      logPath={logPath}
      allowSwitchToLocal={allowSwitchToLocal === true}
      onExit={onExit}
      onSwitchToLocal={onSwitchToLocal}
    />
  );
};
