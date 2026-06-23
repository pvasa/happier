import { describe, expect, it, vi } from 'vitest';

import type { ApiSessionClient } from '@/api/session/sessionClient';
import type { Credentials } from '@/persistence';
import { runHermesRemoteRuntimePass } from './runHermesRemoteRuntimePass';

function createSession(invokeLocal: (method: string, params: unknown) => Promise<unknown> = async () => undefined): ApiSessionClient {
  return {
    sessionId: 'host-session-1',
    getMetadataSnapshot: () => ({ path: '/tmp/workspace' }),
    rpcHandlerManager: { invokeLocal },
  } as unknown as ApiSessionClient;
}

const baseOpts = {
  credentials: { token: 'x' } as unknown as Credentials,
} as const;

describe('runHermesRemoteRuntimePass', () => {
  it('drives the runtime on the injected host session via runStandardAcpProvider', async () => {
    const session = createSession();
    let injectedSession: unknown = null;
    const runStandardAcpProviderFn = vi.fn(async (opts: any) => {
      injectedSession = opts.injectedSession;
      return undefined;
    });

    const result = await runHermesRemoteRuntimePass({
      opts: { ...baseOpts },
      session,
    }, { runStandardAcpProviderFn });

    expect(runStandardAcpProviderFn).toHaveBeenCalledTimes(1);
    expect(injectedSession).toBe(session);
    expect(result).toBe('exit');
  });

  it('renders a read-only Hermes remote display (no text composer) as the terminal display', async () => {
    const session = createSession();
    let capturedConfig: any = null;
    const runStandardAcpProviderFn = vi.fn(async (_opts: any, config: any) => {
      capturedConfig = config;
      return undefined;
    });

    await runHermesRemoteRuntimePass({
      opts: { ...baseOpts },
      session,
    }, { runStandardAcpProviderFn });

    // Read-only remote runtime display, not the full local TUI (HermesTerminalDisplay).
    expect(capturedConfig.terminalDisplay.name).toBe('HermesRemoteRuntimeDisplay');
    expect(typeof capturedConfig.onSwitchToLocal).toBe('function');
    expect(capturedConfig.shouldRenderTerminalDisplay()).toBe(true);
    expect(capturedConfig.resolveKeepAliveMode()).toBe('remote');
  });

  it('reports a switch result when the provider resolves with switch-to-local', async () => {
    const session = createSession();
    const runStandardAcpProviderFn = vi.fn(async () => ({ type: 'switch-to-local' as const }));

    const result = await runHermesRemoteRuntimePass({
      opts: { ...baseOpts },
      session,
    }, { runStandardAcpProviderFn });

    expect(result).toBe('switch');
  });

  it("routes the host display's switch-to-local through the in-process `switch` handler", async () => {
    const invokeLocal = vi.fn(async () => undefined);
    const session = createSession(invokeLocal);
    let capturedConfig: any = null;
    const runStandardAcpProviderFn = vi.fn(async (_opts: any, config: any) => {
      capturedConfig = config;
      return undefined;
    });

    await runHermesRemoteRuntimePass({
      opts: { ...baseOpts },
      session,
    }, { runStandardAcpProviderFn });

    // Simulate the host pressing the read-only display's switch-to-local button.
    await capturedConfig.terminalDisplay({ messageBuffer: { getMessages: () => [], onUpdate: () => () => undefined }, onExit: () => undefined }).props.onSwitchToLocal();

    expect(invokeLocal).toHaveBeenCalledWith('switch', { to: 'local' });
  });
})
