import { describe, expect, it, vi } from 'vitest';

import { createPlainSessionFixture } from '@/testkit/backends/sessionFixtures';
import {
  type ApiSessionSocketStub,
  createApiSessionSocketStub,
} from '@/testkit/backends/apiSessionSocketHarness';

type Ack = { ok: true; id: string; seq: number; localId: string };

type DelayedSocketStub = ApiSessionSocketStub & {
  state: {
    maxInFlight: number;
    inFlight: number;
    pendingResolvers: Array<(ack: Ack) => void>;
  };
  resolveNext: (ack: Ack) => void;
};

function createDelayedSocketStub(): DelayedSocketStub {
  const state = {
    maxInFlight: 0,
    inFlight: 0,
    pendingResolvers: [] as Array<(ack: Ack) => void>,
  };

  return Object.assign(
    createApiSessionSocketStub({
      connected: true,
      emitWithAck: async (event: string) => {
        if (event !== 'message') {
          return { ok: true };
        }

        state.inFlight += 1;
        state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);

        return new Promise((resolve) => {
          state.pendingResolvers.push((ack) => {
            state.inFlight -= 1;
            resolve(ack);
          });
        });
      },
    }),
    {
      state,
      resolveNext: (ack: Ack) => {
        const next = state.pendingResolvers.shift();
        if (!next) {
          throw new Error('No pending socket ack resolver');
        }
        next(ack);
      },
    },
  );
}

let sessionSocketStub: ApiSessionSocketStub | null = null;
let userSocketStub: ApiSessionSocketStub | null = null;
let supervisorStartCount = 0;

vi.mock('./sockets', () => ({
  createUserScopedSocket: () => {
    if (!userSocketStub) throw new Error('Missing user socket stub');
    return userSocketStub as any;
  },
}));

vi.mock('./connection/createSessionSocketTransport', () => ({
  createSessionSocketTransport: () => {
    if (!sessionSocketStub) throw new Error('Missing session socket stub');
    return {
      socket: sessionSocketStub as any,
      transport: {
        connect: async () => {},
        disconnect: async () => {},
        destroy: async () => {},
        isConnected: () => sessionSocketStub?.connected === true,
        onConnected: () => () => {},
        onDisconnected: () => () => {},
        onError: () => () => {},
      },
    };
  },
}));

vi.mock('@happier-dev/connection-supervisor', () => ({
  DEFAULT_MANAGED_CONNECTION_POLICY: {},
  createManagedConnectionSupervisor: (params: { createTransport: () => unknown; onConnected?: () => Promise<void> | void }) => ({
    start: async () => {
      supervisorStartCount += 1;
      params.createTransport();
      await params.onConnected?.();
    },
    stop: async () => {},
  }),
}));

describe('ApiSessionClient message commit queue', () => {
  it('persists turn_failed as failed primary turn runtime state', async () => {
    vi.resetModules();
    const runtimeStateUpdates: unknown[] = [];
    sessionSocketStub = createApiSessionSocketStub({
      connected: true,
      emitWithAck: async (event: string, payload: any) => {
        if (event === 'update-state') {
          runtimeStateUpdates.push(payload.runtimeIssueSummaryV1);
          return {
            result: 'success',
            agentState: payload.agentState,
            version: payload.expectedVersion + 1,
          };
        }
        return { ok: true, id: 'm1', seq: 1, localId: payload?.localId ?? 'l1' };
      },
    });
    userSocketStub = createApiSessionSocketStub({ connected: true, emitWithAckResult: { ok: true } });

    const { ApiSessionClient } = await import('./sessionClient');

    const client = new ApiSessionClient('tok', createPlainSessionFixture({ id: 's1' }));

    client.sendAgentMessage('opencode' as any, { type: 'turn_failed', id: 'turn-1' } as any);

    await expect.poll(() => runtimeStateUpdates).toEqual([
      { latestTurnStatus: 'failed' },
    ]);
  });

  it('treats disconnected primary turn state updates as non-fatal', async () => {
    vi.resetModules();
    sessionSocketStub = createApiSessionSocketStub({
      connected: false,
      emitWithAck: async () => {
        throw new Error('socket emit should not be reached while disconnected');
      },
    });
    userSocketStub = createApiSessionSocketStub({ connected: true, emitWithAckResult: { ok: true } });

    const [{ ApiSessionClient }, { logger }] = await Promise.all([
      import('./sessionClient'),
      import('@/ui/logger'),
    ]);
    const debugSpy = vi.spyOn(logger, 'debug').mockImplementation(() => {});

    const client = new ApiSessionClient('tok', createPlainSessionFixture({ id: 's1' }));

    client.sendAgentMessage('claude' as any, { type: 'task_complete', id: 'turn-1' } as any);

    await expect.poll(() => debugSpy.mock.calls).toContainEqual([
      '[API] Failed to update primary turn runtime state (non-fatal)',
      expect.objectContaining({
        latestTurnStatus: 'completed',
        error: expect.objectContaining({
          message: 'update-state socket is not connected',
        }),
      }),
    ]);

    debugSpy.mockRestore();
  });

  it('requests reconnect when message commits queue while disconnected', async () => {
    vi.resetModules();
    supervisorStartCount = 0;
    sessionSocketStub = createApiSessionSocketStub({
      connected: false,
      emitWithAck: async () => {
        throw new Error('socket emit should not be reached while disconnected');
      },
    });
    userSocketStub = createApiSessionSocketStub({ connected: true, emitWithAckResult: { ok: true } });

    const { ApiSessionClient } = await import('./sessionClient');

    const client = new ApiSessionClient('tok', createPlainSessionFixture({ id: 's1' }));

    await expect.poll(() => supervisorStartCount).toBe(1);

    client.sendAgentMessage('claude' as any, { type: 'message', message: 'FAKE_CLAUDE_OK_2' } as any);

    await expect.poll(() => supervisorStartCount).toBeGreaterThan(1);
  });

  it('serializes best-effort message commits to avoid concurrent socket acks', async () => {
    vi.resetModules();
    supervisorStartCount = 0;
    const delayedSessionSocket = createDelayedSocketStub();
    sessionSocketStub = delayedSessionSocket;
    userSocketStub = createApiSessionSocketStub({ connected: true, emitWithAckResult: { ok: true } });

    const { ApiSessionClient } = await import('./sessionClient');

    const client = new ApiSessionClient('tok', createPlainSessionFixture({ id: 's1' }));

    client.sendAgentMessage('opencode' as any, { type: 'message', message: 'a' } as any);
    client.sendAgentMessage('opencode' as any, { type: 'message', message: 'b' } as any);
    client.sendAgentMessage('opencode' as any, { type: 'message', message: 'c' } as any);

    const waitForPending = async (count: number) => {
      const start = Date.now();
    while (delayedSessionSocket.state.pendingResolvers.length < count) {
        if (Date.now() - start > 1_000) {
          throw new Error('Timed out waiting for socket ack resolvers');
        }
        await Promise.resolve();
      }
    };

    await waitForPending(1);

    expect(delayedSessionSocket.state.maxInFlight).toBe(1);

    delayedSessionSocket.resolveNext({ ok: true, id: 'm1', seq: 1, localId: 'l1' });
    await waitForPending(1);

    delayedSessionSocket.resolveNext({ ok: true, id: 'm2', seq: 2, localId: 'l2' });
    await waitForPending(1);

    delayedSessionSocket.resolveNext({ ok: true, id: 'm3', seq: 3, localId: 'l3' });
  });
});
