import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RPC_ERROR_CODES } from '@happier-dev/protocol/rpc';

const { mockSessionRpcWithServerScope, mockResolveContext, mockApiSend, mockCreateEphemeralClient, mockApplySessionListRenderablePatches } = vi.hoisted(
  () => ({
    mockSessionRpcWithServerScope: vi.fn(),
    mockResolveContext: vi.fn(),
    mockApiSend: vi.fn(),
    mockCreateEphemeralClient: vi.fn(),
    mockApplySessionListRenderablePatches: vi.fn(),
  }),
);

vi.mock('../../runtime/orchestration/serverScopedRpc/serverScopedSessionRpc', () => ({
  sessionRpcWithServerScope: mockSessionRpcWithServerScope,
}));

vi.mock('../../runtime/orchestration/serverScopedRpc/resolveServerScopedSessionContext', () => ({
  resolveServerScopedSessionContext: mockResolveContext,
}));

vi.mock('../../api/session/apiSocket', () => ({
  apiSocket: {
    send: mockApiSend,
  },
}));

vi.mock('../../runtime/orchestration/serverScopedRpc/createEphemeralServerSocketClient', () => ({
  createEphemeralServerSocketClient: mockCreateEphemeralClient,
}));

vi.mock('../../domains/state/storage', () => ({
  storage: {
    getState: () => ({
      applySessionListRenderablePatches: mockApplySessionListRenderablePatches,
    }),
  },
}));

// ops.ts imports ./sync, which pulls in Expo-native modules in node/vitest.
// sessionStopWithServerScope doesn't need real encryption in these tests.
vi.mock('../../sync', () => ({
  sync: {
    encryption: {
      getSessionEncryption: () => null,
      getMachineEncryption: () => null,
    },
  },
}));

import { sessionStopWithServerScope } from '../../ops';

describe('sessionStopWithServerScope', () => {
  beforeEach(() => {
    mockSessionRpcWithServerScope.mockReset();
    mockResolveContext.mockReset();
    mockApiSend.mockReset();
    mockCreateEphemeralClient.mockReset();
    mockApplySessionListRenderablePatches.mockReset();
  });

  it('marks the local cache-only list row inactive after a successful kill RPC', async () => {
    mockSessionRpcWithServerScope.mockResolvedValue({ success: true });

    const res = await sessionStopWithServerScope('sid-killed', { serverId: 'server-a' });

    expect(res).toEqual({ success: true });
    expect(mockApplySessionListRenderablePatches).toHaveBeenCalledWith([
      {
        sessionId: 'sid-killed',
        patch: expect.objectContaining({
          active: false,
          thinking: false,
          activeAt: expect.any(Number),
          thinkingAt: expect.any(Number),
          presence: expect.any(Number),
          updatedAt: expect.any(Number),
        }),
      },
    ]);
  });

  it('falls back to session-end on the active socket when scope is active and RPC method is unavailable', async () => {
    const err: any = new Error('RPC method not available');
    err.rpcErrorCode = RPC_ERROR_CODES.METHOD_NOT_AVAILABLE;
    mockSessionRpcWithServerScope.mockRejectedValue(err);
    mockResolveContext.mockResolvedValue({
      scope: 'active',
      targetServerUrl: 'https://active.example',
      targetServerId: 'server-a',
      token: 'tok',
      timeoutMs: 1000,
      encryption: null,
    });

    const res = await sessionStopWithServerScope('sid-1', { serverId: 'server-a' });
    expect(res).toEqual({ success: true });
    expect(mockApiSend).toHaveBeenCalledWith(
      'session-end',
      expect.objectContaining({ sid: 'sid-1', time: expect.any(Number) }),
    );
    expect(mockApplySessionListRenderablePatches).toHaveBeenCalledWith([
      {
        sessionId: 'sid-1',
        patch: expect.objectContaining({
          active: false,
          thinking: false,
          activeAt: expect.any(Number),
          presence: expect.any(Number),
        }),
      },
    ]);
  });

  it('falls back to session-end on an ephemeral socket when scope is not active and RPC method is unavailable', async () => {
    const err: any = new Error('RPC method not available');
    err.rpcErrorCode = RPC_ERROR_CODES.METHOD_NOT_AVAILABLE;
    mockSessionRpcWithServerScope.mockRejectedValue(err);
    mockResolveContext.mockResolvedValue({
      scope: 'scoped',
      targetServerUrl: 'https://scoped.example',
      targetServerId: 'server-b',
      token: 'tok_scoped',
      timeoutMs: 1000,
      encryption: null,
    });
    const send = vi.fn();
    const disconnect = vi.fn();
    mockCreateEphemeralClient.mockResolvedValue({ emit: send, disconnect, timeout: () => ({ emitWithAck: vi.fn() }) });

    const res = await sessionStopWithServerScope('sid-2', { serverId: 'server-b' });
    expect(res).toEqual({ success: true });
    expect(mockCreateEphemeralClient).toHaveBeenCalledWith(
      expect.objectContaining({ serverUrl: 'https://scoped.example', token: 'tok_scoped' }),
    );
    expect(send).toHaveBeenCalledWith(
      'session-end',
      expect.objectContaining({ sid: 'sid-2', time: expect.any(Number) }),
    );
    expect(disconnect).toHaveBeenCalled();
  });
});
