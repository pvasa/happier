import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RPC_METHODS } from '@happier-dev/protocol/rpc';

import { registerMachineSessionGoalRpcHandlers } from './rpcHandlers.sessionGoals';
import type { Credentials } from '@/persistence';
import type { RpcHandler, RpcHandlerRegistrar } from '../rpc/types';
import { createSessionRecordFixture } from '@/testkit/backends/sessionFixtures';

describe('rpcHandlers.sessionGoals', () => {
  const credentials: Credentials = {
    token: 'token-1',
    encryption: { type: 'legacy', secret: new Uint8Array(32) },
  };

  let handlers: Map<string, (raw: unknown) => Promise<unknown>>;
  let sessionGoalSet: ReturnType<typeof vi.fn>;
  let sessionGoalClear: ReturnType<typeof vi.fn>;
  let sessionGoalGet: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    handlers = new Map();
    sessionGoalSet = vi.fn(async () => ({ ok: true }));
    sessionGoalClear = vi.fn(async () => ({ ok: true }));
    sessionGoalGet = vi.fn(async () => ({ workState: null }));
  });

  function registerWithTransport() {
    const rawSession = createSessionRecordFixture({
      id: 'resolved-session',
      metadata: '{}',
      path: '/repo',
      host: 'localhost',
      machineId: 'machine-1',
      encryptionMode: 'plain',
    });
    registerMachineSessionGoalRpcHandlers({
      rpcHandlerManager: {
        registerHandler: <TRequest, TResponse>(method: string, handler: RpcHandler<TRequest, TResponse>) => {
          handlers.set(method, async (raw: unknown) => await handler(raw as TRequest));
        },
      } satisfies RpcHandlerRegistrar,
      deps: {
        readCredentials: async () => credentials,
        resolveSessionTransportContext: async () => ({
          ok: true,
          sessionId: 'resolved-session',
          rawSession,
          ctx: {
            encryptionKey: new Uint8Array(32),
            encryptionVariant: 'legacy',
          },
          mode: 'plain',
        }),
        createCliActionDeps: () => ({
          sessionGoalSet,
          sessionGoalClear,
          sessionGoalGet,
        }),
      },
    });
  }

  it('routes inactive-session goal set controls through CLI action deps', async () => {
    registerWithTransport();

    const result = await handlers.get(RPC_METHODS.DAEMON_SESSION_GOAL_SET)?.({
      sessionId: 'session-prefix',
      status: 'paused',
    });

    expect(result).toEqual({ ok: true });
    expect(sessionGoalSet).toHaveBeenCalledWith({
      sessionId: 'resolved-session',
      status: 'paused',
    });
  });

  it('routes inactive-session goal clear controls through CLI action deps', async () => {
    registerWithTransport();

    const result = await handlers.get(RPC_METHODS.DAEMON_SESSION_GOAL_CLEAR)?.({
      sessionId: 'session-prefix',
    });

    expect(result).toEqual({ ok: true });
    expect(sessionGoalClear).toHaveBeenCalledWith({ sessionId: 'resolved-session' });
  });

  it('returns stable invalid-parameter errors before dispatching malformed controls', async () => {
    registerWithTransport();

    const result = await handlers.get(RPC_METHODS.DAEMON_SESSION_GOAL_SET)?.({
      sessionId: 'session-prefix',
    });

    expect(result).toEqual({
      ok: false,
      errorCode: 'invalid_parameters',
      error: 'invalid_parameters',
    });
    expect(sessionGoalSet).not.toHaveBeenCalled();
  });
});
