import { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createDeferred, flushHookEffects, renderHook } from '@/dev/testkit';
import { createReducer } from '@/sync/reducer/reducer';
import { storage } from '@/sync/domains/state/storageStore';

import { useUserMessageHistory } from './useUserMessageHistory';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fetchUserMessageHistoryPageMock = vi.hoisted(() => vi.fn());
const roleQuerySupportedState = vi.hoisted(() => ({ supported: true }));

vi.mock('@/sync/sync', () => ({
    sync: {
        fetchUserMessageHistoryPage: (...args: unknown[]) => fetchUserMessageHistoryPageMock(...args),
    },
}));

vi.mock('@/sync/runtime/orchestration/serverScopedRpc/usePreferredServerIdForSession', () => ({
    usePreferredServerIdForSession: () => 'server-1',
}));

vi.mock('@/sync/domains/features/featureDecisionRuntime', () => ({
    useServerFeaturesSnapshotForServerId: () => ({
        status: 'ready',
        features: {
            capabilities: {
                session: {
                    messages: {
                        role: roleQuerySupportedState.supported,
                    },
                },
            },
        },
    }),
}));

describe('useUserMessageHistory server role query', () => {
    afterEach(() => {
        vi.clearAllMocks();
        roleQuerySupportedState.supported = true;
        storage.setState((state) => ({
            ...state,
            sessionMessages: {},
        }));
    });

    it('loads server user messages on warmup when no local per-session history is loaded', async () => {
        fetchUserMessageHistoryPageMock.mockResolvedValueOnce({
            status: 'loaded',
            entries: [{ seq: 3, createdAt: 30, text: 'from server' }],
            hasMore: false,
            nextBeforeSeq: null,
        });

        const hook = await renderHook(() =>
            useUserMessageHistory({ scope: 'perSession', sessionId: 's1', maxEntries: 20 }),
        );

        await act(async () => {
            hook.getCurrent().warmup();
            await flushHookEffects();
        });

        expect(fetchUserMessageHistoryPageMock).toHaveBeenCalledWith('s1', {
            limit: 25,
        });
        expect(hook.getCurrent().moveUp('draft')).toBe('from server');
        await hook.unmount();
    });

    it('does not query old servers without session message role capability', async () => {
        roleQuerySupportedState.supported = false;
        const hook = await renderHook(() =>
            useUserMessageHistory({ scope: 'perSession', sessionId: 's1', maxEntries: 20 }),
        );

        await act(async () => {
            hook.getCurrent().warmup();
            await flushHookEffects();
        });

        expect(fetchUserMessageHistoryPageMock).not.toHaveBeenCalled();
        await hook.unmount();
    });

    it('prefetches before reaching the oldest loaded user message and stops after exhaustion', async () => {
        fetchUserMessageHistoryPageMock
            .mockResolvedValueOnce({
                status: 'loaded',
                entries: [
                    { seq: 10, createdAt: 100, text: 'ten' },
                    { seq: 9, createdAt: 90, text: 'nine' },
                    { seq: 8, createdAt: 80, text: 'eight' },
                    { seq: 7, createdAt: 70, text: 'seven' },
                ],
                hasMore: true,
                nextBeforeSeq: 7,
            })
            .mockResolvedValueOnce({
                status: 'loaded',
                entries: [],
                hasMore: false,
                nextBeforeSeq: null,
            });

        const hook = await renderHook(() =>
            useUserMessageHistory({ scope: 'perSession', sessionId: 's1', maxEntries: 20 }),
        );

        await act(async () => {
            hook.getCurrent().warmup();
            await flushHookEffects();
        });

        expect(hook.getCurrent().moveUp('draft')).toBe('ten');

        await act(async () => {
            expect(hook.getCurrent().moveUp('ten')).toBe('nine');
            await flushHookEffects();
        });

        expect(fetchUserMessageHistoryPageMock).toHaveBeenLastCalledWith('s1', {
            limit: 25,
            beforeSeq: 7,
        });

        await act(async () => {
            expect(hook.getCurrent().moveUp('nine')).toBe('eight');
            expect(hook.getCurrent().moveUp('eight')).toBe('seven');
            await flushHookEffects();
        });

        expect(fetchUserMessageHistoryPageMock).toHaveBeenCalledTimes(2);
        await hook.unmount();
    });

    it('ignores a remote history page that resolves after switching sessions', async () => {
        const stalePage = createDeferred<{
            status: 'loaded';
            entries: Array<{ seq: number; createdAt: number; text: string }>;
            hasMore: boolean;
            nextBeforeSeq: number | null;
        }>();
        fetchUserMessageHistoryPageMock.mockReturnValueOnce(stalePage.promise);

        const hook = await renderHook(
            (props: { sessionId: string }) =>
                useUserMessageHistory({ scope: 'perSession', sessionId: props.sessionId, maxEntries: 20 }),
            { initialProps: { sessionId: 's1' } },
        );

        await act(async () => {
            hook.getCurrent().warmup();
            await flushHookEffects();
        });

        storage.setState((state) => ({
            ...state,
            sessionMessages: {
                s2: {
                    messageIdsOldestFirst: ['s2-user'],
                    messagesById: {
                        's2-user': {
                            kind: 'user-text',
                            id: 's2-user',
                            localId: null,
                            createdAt: 40,
                            text: 'session two prompt',
                        },
                    },
                    messagesMap: {
                        's2-user': {
                            kind: 'user-text',
                            id: 's2-user',
                            localId: null,
                            createdAt: 40,
                            text: 'session two prompt',
                        },
                    },
                    reducerState: createReducer(),
                    latestThinkingMessageId: null,
                    latestThinkingMessageActivityAtMs: null,
                    latestReadyEventSeq: null,
                    latestReadyEventAt: null,
                    messagesVersion: 1,
                    lastAppliedAgentStateVersion: null,
                    isLoaded: true,
                },
            },
        }));
        await hook.rerender({ sessionId: 's2' });

        await act(async () => {
            stalePage.resolve({
                status: 'loaded',
                entries: [{ seq: 3, createdAt: 30, text: 'stale session one prompt' }],
                hasMore: false,
                nextBeforeSeq: null,
            });
            await stalePage.promise;
            await flushHookEffects();
        });

        fetchUserMessageHistoryPageMock.mockResolvedValueOnce({
            status: 'loaded',
            entries: [],
            hasMore: false,
            nextBeforeSeq: null,
        });
        expect(hook.getCurrent().moveUp('draft')).toBe('session two prompt');
        await hook.unmount();
    });

    it('keeps active browsing state when role-query support becomes ready', async () => {
        roleQuerySupportedState.supported = false;
        storage.setState((state) => ({
            ...state,
            sessionMessages: {
                s1: {
                    messageIdsOldestFirst: ['older', 'newer'],
                    messagesById: {
                        older: { kind: 'user-text', id: 'older', localId: null, createdAt: 10, text: 'older prompt' },
                        newer: { kind: 'user-text', id: 'newer', localId: null, createdAt: 20, text: 'newer prompt' },
                    },
                    messagesMap: {
                        older: { kind: 'user-text', id: 'older', localId: null, createdAt: 10, text: 'older prompt' },
                        newer: { kind: 'user-text', id: 'newer', localId: null, createdAt: 20, text: 'newer prompt' },
                    },
                    reducerState: createReducer(),
                    latestThinkingMessageId: null,
                    latestThinkingMessageActivityAtMs: null,
                    latestReadyEventSeq: null,
                    latestReadyEventAt: null,
                    messagesVersion: 1,
                    lastAppliedAgentStateVersion: null,
                    isLoaded: true,
                },
            },
        }));

        const hook = await renderHook(() =>
            useUserMessageHistory({ scope: 'perSession', sessionId: 's1', maxEntries: 20 }),
        );

        expect(hook.getCurrent().moveUp('draft')).toBe('newer prompt');

        roleQuerySupportedState.supported = true;
        fetchUserMessageHistoryPageMock.mockResolvedValue({
            status: 'loaded',
            entries: [],
            hasMore: false,
            nextBeforeSeq: null,
        });
        await hook.rerender();

        expect(hook.getCurrent().moveUp('newer prompt')).toBe('older prompt');
        await hook.unmount();
    });
});
