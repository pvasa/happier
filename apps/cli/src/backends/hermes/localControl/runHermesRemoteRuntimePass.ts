/**
 * Hermes remote-mode pass for the terminal-started host.
 *
 * The host process IS the runtime in remote mode (mirrors codex): it runs the
 * Hermes ACP runtime IN-PROCESS on its OWN already-created session, consumes the
 * phone's message queue, drives the agent, and renders a READ-ONLY display of the
 * same in-process MessageBuffer (no text composer; only switch-to-local / exit).
 *
 * Because the host already owns a live session, we run the shared
 * {@link runStandardAcpProvider} with that session injected -- it skips session
 * bootstrap (and the per-session attach secret the `existingSessionId` attach
 * path would require) and drives the runtime + message loop directly. The daemon
 * is NOT relied upon to spawn a separate driver.
 *
 *  - switch-to-local: the phone's `switch` RPC (or the host's keyboard
 *    affordance) tears the run down; we report `'switch'` so the caller re-spawns
 *    `hermes chat`.
 *  - exit: any clean teardown reports `'exit'`.
 */
import type { ApiSessionClient } from '@/api/session/sessionClient';
import {
  runStandardAcpProvider,
  type StandardAcpProviderConfig,
  type StandardAcpProviderRunOptions,
} from '@/agent/runtime/runStandardAcpProvider';

import { createHermesAcpProviderConfig } from '@/backends/hermes/createHermesAcpProviderConfig';
import { createHermesRemoteRuntimeDisplay } from '@/backends/hermes/ui/createHermesRemoteRuntimeDisplay';

export type HermesRemoteRuntimePassResult = 'switch' | 'exit';

type RunHermesRemoteRuntimePassDeps = {
  runStandardAcpProviderFn?: typeof runStandardAcpProvider;
};

export async function runHermesRemoteRuntimePass(
  params: Readonly<{
    opts: StandardAcpProviderRunOptions;
    session: ApiSessionClient;
  }>,
  deps: RunHermesRemoteRuntimePassDeps = {},
): Promise<HermesRemoteRuntimePassResult> {
  const runStandardAcpProviderFn = deps.runStandardAcpProviderFn ?? runStandardAcpProvider;

  // Both the host's keyboard switch-to-local affordance (read-only display button)
  // and the phone's `switch` RPC route through the SAME `switch` handler that
  // runStandardAcpProvider registers (via `onSwitchToLocal` below): that handler
  // tears the run down and resolves with `{ type: 'switch-to-local' }`. The host
  // button reaches it by invoking the handler in-process; `onSwitchToLocal` then
  // records that this teardown is a switch (not a plain exit).
  let switchRequested = false;
  const invokeSwitchToLocal = async (): Promise<void> => {
    await params.session.rpcHandlerManager.invokeLocal('switch', { to: 'local' });
  };

  const config: StandardAcpProviderConfig = {
    ...createHermesAcpProviderConfig(),
    terminalDisplay: createHermesRemoteRuntimeDisplay({ onSwitchToLocal: invokeSwitchToLocal }),
    shouldRenderTerminalDisplay: () => true,
    resolveKeepAliveMode: () => 'remote',
    onSwitchToLocal: () => {
      switchRequested = true;
    },
  };

  const result = await runStandardAcpProviderFn(
    { ...params.opts, injectedSession: params.session },
    config,
  );

  if (result?.type === 'switch-to-local' || switchRequested) {
    return 'switch';
  }
  return 'exit';
}
