import { createSessionScopedSocket } from '@/api/session/sockets';
import { SOCKET_RPC_EVENTS } from '@happier-dev/protocol/socketRpc';
import { createRpcCallError } from '@happier-dev/protocol/rpcErrors';
import { decodeBase64, decrypt, encodeBase64, encrypt } from '@/api/encryption';
import type { SessionEncryptionContext, SessionStoredContentEncryptionMode } from '@/session/transport/encryption/sessionEncryptionContext';
import { waitForSocketConnect } from '@/session/transport/socket/waitForSocketConnect';
import { resolveSessionControlSocketConnectTimeoutMs } from '@/session/transport/shared/sessionTimeouts';

export async function callSessionRpc(params: Readonly<{
  token: string;
  sessionId: string;
  mode?: SessionStoredContentEncryptionMode;
  ctx: SessionEncryptionContext;
  method: string;
  request: unknown;
  timeoutMs?: number;
}>): Promise<unknown> {
  const socket = createSessionScopedSocket({ token: params.token, sessionId: params.sessionId });
  const timeoutMs = typeof params.timeoutMs === 'number' && params.timeoutMs > 0 ? params.timeoutMs : 20_000;
  const connectTimeoutMs = typeof params.timeoutMs === 'number' && params.timeoutMs > 0 ? timeoutMs : resolveSessionControlSocketConnectTimeoutMs();
  let cleanedUp = false;

  const cleanupSocket = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    try {
      socket.disconnect();
    } catch {
      // ignore cleanup failures; preserve the original RPC/connect outcome
    }
    try {
      socket.close();
    } catch {
      // ignore cleanup failures; preserve the original RPC/connect outcome
    }
  };

  try {
    const connectPromise = waitForSocketConnect(socket as unknown as import('socket.io-client').Socket, connectTimeoutMs);
    socket.connect();
    await connectPromise;

    const mode: SessionStoredContentEncryptionMode = params.mode ?? 'e2ee';
    const rpcParams = mode === 'plain'
      ? params.request
      : encodeBase64(encrypt(params.ctx.encryptionKey, params.ctx.encryptionVariant, params.request), 'base64');

    const response = await new Promise<{ ok: boolean; result?: unknown; error?: string; errorCode?: string }>((resolve, reject) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout>;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn();
      };
      timer = setTimeout(() => finish(() => reject(new Error('RPC call timeout'))), timeoutMs);
      try {
        socket.emit(
          SOCKET_RPC_EVENTS.CALL,
          { method: params.method, params: rpcParams },
          (payload: { ok: boolean; result?: unknown; error?: string; errorCode?: string }) => {
            finish(() => resolve(payload));
          },
        );
      } catch (error) {
        finish(() => reject(error));
      }
    });

    if (!response.ok) {
      throw createRpcCallError({
        error: response.error || 'RPC call failed',
        errorCode: response.errorCode,
      });
    }

    if (mode === 'plain') {
      return response.result ?? null;
    }

    const encryptedResult = typeof response.result === 'string' ? response.result.trim() : '';
    if (!encryptedResult) return null;
    return decrypt(params.ctx.encryptionKey, params.ctx.encryptionVariant, decodeBase64(encryptedResult, 'base64'));
  } finally {
    cleanupSocket();
  }
}
