import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RPC_ERROR_CODES } from '@happier-dev/protocol/rpc';
import { readRpcErrorCode } from '@happier-dev/protocol/rpcErrors';

let nextRpcAck: any = null;
let nextConnectError: Error | null = null;
let nextEmitError: Error | null = null;
let nextEmitNeverAcks = false;
const createdSockets: FakeSocket[] = [];

class FakeSocket {
  private handlers = new Map<string, Array<(...args: any[]) => void>>();
  public emitted: Array<{ event: string; data: any }> = [];
  public disconnectCalls = 0;
  public closeCalls = 0;

  on(event: string, handler: (...args: any[]) => void) {
    const list = this.handlers.get(event) ?? [];
    list.push(handler);
    this.handlers.set(event, list);
    return this;
  }

  off(event: string, handler: (...args: any[]) => void) {
    const list = this.handlers.get(event) ?? [];
    this.handlers.set(event, list.filter((candidate) => candidate !== handler));
    return this;
  }

  listenerCount(event: string) {
    return this.handlers.get(event)?.length ?? 0;
  }

  connect() {
    if (nextConnectError) {
      for (const handler of this.handlers.get('connect_error') ?? []) {
        handler(nextConnectError);
      }
      return this;
    }
    for (const handler of this.handlers.get('connect') ?? []) {
      handler();
    }
    return this;
  }

  emit(event: string, data: any, callback: (payload: any) => void) {
    if (nextEmitError) {
      throw nextEmitError;
    }
    this.emitted.push({ event, data });
    if (nextEmitNeverAcks) return this;
    callback(nextRpcAck ?? { ok: true, result: { echoed: data.params } });
    return this;
  }

  disconnect() {
    this.disconnectCalls += 1;
  }

  close() {
    this.closeCalls += 1;
  }
}

vi.mock('@/api/session/sockets', () => ({
  createSessionScopedSocket: vi.fn(() => {
    const socket = new FakeSocket();
    createdSockets.push(socket);
    return socket;
  }),
}));

describe('callSessionRpc (plaintext sessions)', () => {
  beforeEach(() => {
    nextRpcAck = null;
    nextConnectError = null;
    nextEmitError = null;
    nextEmitNeverAcks = false;
    createdSockets.length = 0;
    vi.useRealTimers();
  });

  it('sends plaintext params and returns plaintext results when mode=plain', async () => {
    const { callSessionRpc } = await import('./sessionRpc');
    const req = { a: 1 };
    const res = await callSessionRpc({
      token: 't',
      sessionId: 'sess_1',
      mode: 'plain',
      method: 'sess_1:demo.method',
      request: req,
      ctx: { encryptionKey: new Uint8Array(32), encryptionVariant: 'dataKey' },
    });

    expect(res).toEqual({ echoed: req });
    expect(createdSockets[0]?.disconnectCalls).toBe(1);
    expect(createdSockets[0]?.closeCalls).toBe(1);
    expect(createdSockets[0]?.listenerCount('connect')).toBe(0);
    expect(createdSockets[0]?.listenerCount('connect_error')).toBe(0);
  });

  it('throws RpcError with rpcErrorCode when the RPC response includes errorCode', async () => {
    nextRpcAck = {
      ok: false,
      error: 'RPC method not available',
      errorCode: RPC_ERROR_CODES.METHOD_NOT_AVAILABLE,
    };

    const { callSessionRpc } = await import('./sessionRpc');
    await expect(
      callSessionRpc({
        token: 't',
        sessionId: 'sess_1',
        mode: 'plain',
        method: 'sess_1:demo.method',
        request: { a: 1 },
        ctx: { encryptionKey: new Uint8Array(32), encryptionVariant: 'dataKey' },
      }),
    ).rejects.toSatisfy((error: unknown) => readRpcErrorCode(error) === RPC_ERROR_CODES.METHOD_NOT_AVAILABLE);
    expect(createdSockets[0]?.disconnectCalls).toBe(1);
    expect(createdSockets[0]?.closeCalls).toBe(1);
    expect(createdSockets[0]?.listenerCount('connect')).toBe(0);
    expect(createdSockets[0]?.listenerCount('connect_error')).toBe(0);
  });

  it('closes the one-shot socket when connect fails', async () => {
    nextConnectError = new Error('connect rejected');
    const { callSessionRpc } = await import('./sessionRpc');

    await expect(
      callSessionRpc({
        token: 't',
        sessionId: 'sess_1',
        mode: 'plain',
        method: 'sess_1:demo.method',
        request: { a: 1 },
        ctx: { encryptionKey: new Uint8Array(32), encryptionVariant: 'dataKey' },
      }),
    ).rejects.toThrow('connect rejected');

    expect(createdSockets[0]?.disconnectCalls).toBe(1);
    expect(createdSockets[0]?.closeCalls).toBe(1);
    expect(createdSockets[0]?.listenerCount('connect')).toBe(0);
    expect(createdSockets[0]?.listenerCount('connect_error')).toBe(0);
  });

  it('closes the one-shot socket when emit throws', async () => {
    nextEmitError = new Error('emit exploded');
    const { callSessionRpc } = await import('./sessionRpc');

    await expect(
      callSessionRpc({
        token: 't',
        sessionId: 'sess_1',
        mode: 'plain',
        method: 'sess_1:demo.method',
        request: { a: 1 },
        ctx: { encryptionKey: new Uint8Array(32), encryptionVariant: 'dataKey' },
      }),
    ).rejects.toThrow('emit exploded');

    expect(createdSockets[0]?.disconnectCalls).toBe(1);
    expect(createdSockets[0]?.closeCalls).toBe(1);
    expect(createdSockets[0]?.listenerCount('connect')).toBe(0);
    expect(createdSockets[0]?.listenerCount('connect_error')).toBe(0);
  });

  it('closes the one-shot socket when the RPC ack times out', async () => {
    vi.useFakeTimers();
    nextEmitNeverAcks = true;
    const { callSessionRpc } = await import('./sessionRpc');

    const result = callSessionRpc({
      token: 't',
      sessionId: 'sess_1',
      mode: 'plain',
      method: 'sess_1:demo.method',
      request: { a: 1 },
      timeoutMs: 5,
      ctx: { encryptionKey: new Uint8Array(32), encryptionVariant: 'dataKey' },
    });
    const rejection = expect(result).rejects.toThrow('RPC call timeout');
    await vi.runAllTimersAsync();

    await rejection;
    expect(createdSockets[0]?.disconnectCalls).toBe(1);
    expect(createdSockets[0]?.closeCalls).toBe(1);
    expect(createdSockets[0]?.listenerCount('connect')).toBe(0);
    expect(createdSockets[0]?.listenerCount('connect_error')).toBe(0);
  });
});
