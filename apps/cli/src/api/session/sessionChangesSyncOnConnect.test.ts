import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AxiosError, AxiosHeaders } from 'axios';

const fetchChanges = vi.fn();
const readLastChangesCursor = vi.fn(async () => 0);
const writeLastChangesCursor = vi.fn(async () => {});

vi.mock('../changes', () => ({ fetchChanges }));
vi.mock('@/persistence', () => ({ readLastChangesCursor, writeLastChangesCursor }));

describe('runSessionChangesSyncOnConnect', () => {
  beforeEach(() => {
    fetchChanges.mockReset();
    readLastChangesCursor.mockReset();
    readLastChangesCursor.mockResolvedValue(0);
    writeLastChangesCursor.mockReset();
  });

  it('applies pending count/version hints from relevant /v2/changes session entries', async () => {
    const { runSessionChangesSyncOnConnect } = await import('./sessionChangesSyncOnConnect');
    const applyPendingQueueState = vi.fn();
    const syncSessionSnapshotFromServer = vi.fn(async () => {});

    fetchChanges.mockResolvedValueOnce({
      status: 'ok',
      response: {
        changes: [
          {
            cursor: 1,
            kind: 'session',
            entityId: 's1',
            changedAt: 100,
            hint: { pendingCount: 4, pendingVersion: 12 },
          },
        ],
        nextCursor: 1,
      },
    });

    await runSessionChangesSyncOnConnect({
      reason: 'connect',
      token: 'tok',
      sessionId: 's1',
      lastObservedMessageSeq: 0,
      getAccountId: async () => 'account-1',
      catchUpSessionMessages: async () => {},
      syncSessionSnapshotFromServer,
      applyPendingQueueState,
      onDebug: () => {},
    } satisfies Parameters<typeof runSessionChangesSyncOnConnect>[0]);

    expect(applyPendingQueueState).toHaveBeenCalledWith({ known: true, pendingCount: 4, pendingVersion: 12 });
    expect(syncSessionSnapshotFromServer).not.toHaveBeenCalled();
    expect(writeLastChangesCursor).toHaveBeenCalledWith('account-1', 1);
  });

  it('uses /v2/changes as the stale-socket safety path without forcing a session snapshot', async () => {
    const { runSessionChangesSyncOnConnect } = await import('./sessionChangesSyncOnConnect');
    const applyPendingQueueState = vi.fn();
    const catchUpSessionMessages = vi.fn(async () => {});
    const syncSessionSnapshotFromServer = vi.fn(async () => {});

    fetchChanges.mockResolvedValueOnce({
      status: 'ok',
      response: {
        changes: [
          {
            cursor: 4,
            kind: 'session',
            entityId: 's1',
            changedAt: 400,
            hint: { pendingCount: 3, pendingVersion: 7 },
          },
        ],
        nextCursor: 4,
      },
    });

    await runSessionChangesSyncOnConnect({
      reason: 'socket-stale-safety-tick',
      token: 'tok',
      sessionId: 's1',
      lastObservedMessageSeq: 9,
      getAccountId: async () => 'account-1',
      catchUpSessionMessages,
      syncSessionSnapshotFromServer,
      applyPendingQueueState,
      onDebug: () => {},
    } satisfies Parameters<typeof runSessionChangesSyncOnConnect>[0]);

    expect(applyPendingQueueState).toHaveBeenCalledWith({ known: true, pendingCount: 3, pendingVersion: 7 });
    expect(catchUpSessionMessages).not.toHaveBeenCalled();
    expect(syncSessionSnapshotFromServer).not.toHaveBeenCalled();
    expect(writeLastChangesCursor).toHaveBeenCalledWith('account-1', 4);
  });

  it('falls back to a degraded snapshot when stale-socket changes are relevant but not self-sufficient', async () => {
    const { runSessionChangesSyncOnConnect } = await import('./sessionChangesSyncOnConnect');
    const applyPendingQueueState = vi.fn();
    const catchUpSessionMessages = vi.fn(async () => {});
    const syncSessionSnapshotFromServer = vi.fn(async () => {});

    fetchChanges.mockResolvedValueOnce({
      status: 'ok',
      response: {
        changes: [
          {
            cursor: 5,
            kind: 'session',
            entityId: 's1',
            changedAt: 500,
            hint: null,
          },
        ],
        nextCursor: 5,
      },
    });

    await runSessionChangesSyncOnConnect({
      reason: 'socket-stale-safety-tick',
      token: 'tok',
      sessionId: 's1',
      lastObservedMessageSeq: 9,
      getAccountId: async () => 'account-1',
      catchUpSessionMessages,
      syncSessionSnapshotFromServer,
      applyPendingQueueState,
      onDebug: () => {},
    } satisfies Parameters<typeof runSessionChangesSyncOnConnect>[0]);

    expect(applyPendingQueueState).not.toHaveBeenCalled();
    expect(catchUpSessionMessages).not.toHaveBeenCalled();
    expect(syncSessionSnapshotFromServer).toHaveBeenCalledWith({ reason: 'degraded-socket' });
    expect(writeLastChangesCursor).toHaveBeenCalledWith('account-1', 5);
  });

  it('does not advance the changes cursor when stale-socket transcript catch-up fails', async () => {
    const { runSessionChangesSyncOnConnect } = await import('./sessionChangesSyncOnConnect');
    const catchUpSessionMessages = vi.fn(async () => {
      throw new Error('transient message catch-up failure');
    });
    const syncSessionSnapshotFromServer = vi.fn(async () => {});

    fetchChanges.mockResolvedValueOnce({
      status: 'ok',
      response: {
        changes: [
          {
            cursor: 6,
            kind: 'session',
            entityId: 's1',
            changedAt: 600,
            hint: { lastMessageSeq: 10 },
          },
        ],
        nextCursor: 6,
      },
    });

    await runSessionChangesSyncOnConnect({
      reason: 'socket-stale-safety-tick',
      token: 'tok',
      sessionId: 's1',
      lastObservedMessageSeq: 9,
      getAccountId: async () => 'account-1',
      catchUpSessionMessages,
      syncSessionSnapshotFromServer,
      onDebug: () => {},
    } satisfies Parameters<typeof runSessionChangesSyncOnConnect>[0]);

    expect(catchUpSessionMessages).toHaveBeenCalledWith(9);
    expect(syncSessionSnapshotFromServer).not.toHaveBeenCalled();
    expect(writeLastChangesCursor).not.toHaveBeenCalled();
  });

  it('redacts reconnect catch-up diagnostics', async () => {
    const { runSessionChangesSyncOnConnect } = await import('./sessionChangesSyncOnConnect');
    const onDebug = vi.fn();

    fetchChanges.mockResolvedValueOnce({
      status: 'cursor-gone',
      currentCursor: 8,
    });

    await runSessionChangesSyncOnConnect({
      reason: 'reconnect',
      token: 'tok',
      sessionId: 's1',
      lastObservedMessageSeq: 0,
      getAccountId: async () => 'account-1',
      catchUpSessionMessages: async () => {
        throw new AxiosError('Request failed with Authorization: Bearer MESSAGE_SECRET', 'ERR_BAD_RESPONSE', {
          method: 'get',
          url: 'https://api.example.test/v1/sessions/s1/messages?token=QUERY_SECRET',
          headers: new AxiosHeaders({ Authorization: 'Bearer HEADER_SECRET' }),
          data: { access_token: 'BODY_SECRET' },
        });
      },
      syncSessionSnapshotFromServer: vi.fn(async () => {}),
      onDebug,
    } satisfies Parameters<typeof runSessionChangesSyncOnConnect>[0]);

    const payload = JSON.stringify(onDebug.mock.calls.at(-1)?.[1]);
    expect(payload).toContain('https://api.example.test/v1/sessions/s1/messages');
    expect(payload).not.toContain('MESSAGE_SECRET');
    expect(payload).not.toContain('QUERY_SECRET');
    expect(payload).not.toContain('HEADER_SECRET');
    expect(payload).not.toContain('BODY_SECRET');
    expect(payload).not.toContain('"headers"');
    expect(payload).not.toContain('"data"');
  });
});
