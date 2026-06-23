/**
 * Shared Hermes ACP provider config used by every path that runs the Hermes
 * runtime through {@link runStandardAcpProvider}:
 *  - the daemon-owned remote runtime (full TUI terminal display), and
 *  - the terminal-started host's remote-mode runtime, where the host drives the
 *    agent on its OWN session and layers a READ-ONLY display on top.
 *
 * The base config wires {@link createHermesAcpRuntime}; the remote read-only
 * overrides (terminal display, switch-to-local, keep-alive mode) are layered on
 * by the remote runtime pass.
 */
import { logger } from '@/ui/logger';
import { initialMachineMetadata } from '@/daemon/startDaemon';
import type { StandardAcpProviderConfig } from '@/agent/runtime/runStandardAcpProvider';

import { HermesTerminalDisplay } from '@/backends/hermes/ui/HermesTerminalDisplay';
import { createHermesAcpRuntime } from '@/backends/hermes/acp/runtime';

export function createHermesAcpProviderConfig(): StandardAcpProviderConfig {
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
