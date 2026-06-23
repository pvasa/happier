/**
 * HermesRemoteTerminalDisplay
 *
 * Hermes remote-mode terminal display built on the shared read-only remote
 * control shell. Shown on the host while the phone drives the session.
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
