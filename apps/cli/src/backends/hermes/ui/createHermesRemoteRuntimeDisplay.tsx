/**
 * Builds the read-only terminal display used by the terminal-started Hermes host
 * while it runs the Hermes runtime in remote mode. It adapts the read-only
 * {@link HermesRemoteTerminalDisplay} to the standard provider terminal-display
 * contract (`{ messageBuffer, logPath?, onExit }`), binding the host's
 * switch-to-local affordance so the host can hand control back from its keyboard
 * (the phone hands back over the `switch` RPC). There is no text composer.
 */
import React from 'react';

import type { MessageBuffer } from '@/ui/ink/messageBuffer';

import { HermesRemoteTerminalDisplay } from '@/backends/hermes/ui/HermesRemoteTerminalDisplay';

type StandardTerminalDisplayProps = {
  messageBuffer: MessageBuffer;
  logPath?: string;
  onExit: () => void | Promise<void>;
};

export function createHermesRemoteRuntimeDisplay(params: Readonly<{
  onSwitchToLocal: () => void | Promise<void>;
}>): React.ComponentType<StandardTerminalDisplayProps> {
  const HermesRemoteRuntimeDisplay: React.FC<StandardTerminalDisplayProps> = ({ messageBuffer, logPath, onExit }) => (
    <HermesRemoteTerminalDisplay
      messageBuffer={messageBuffer}
      logPath={logPath}
      allowSwitchToLocal
      onExit={onExit}
      onSwitchToLocal={params.onSwitchToLocal}
    />
  );
  return HermesRemoteRuntimeDisplay;
}
