/**
 * Hermes CLI Entry Point
 *
 * Runs the Nous Research Hermes agent through Happier CLI using ACP.
 */

import type { PermissionMode } from '@/api/types';
import { logger } from '@/ui/logger';
import type { Credentials } from '@/persistence';
import { initialMachineMetadata } from '@/daemon/startDaemon';
import { runStandardAcpProvider, type StandardAcpProviderRunOptions } from '@/agent/runtime/runStandardAcpProvider';

import { HermesTerminalDisplay } from '@/backends/hermes/ui/HermesTerminalDisplay';
import { createHermesAcpRuntime } from '@/backends/hermes/acp/runtime';

export async function runHermes(opts: StandardAcpProviderRunOptions & {
  credentials: Credentials;
  permissionMode?: PermissionMode;
}): Promise<void> {
  await runStandardAcpProvider(opts, {
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
  });
}
