import { act } from 'react-test-renderer';
import { afterEach, describe, expect, it } from 'vitest';

import { renderHook, standardCleanup } from '@/dev/testkit';
import { storage } from '@/sync/domains/state/storageStore';
import type { Session } from '@/sync/domains/state/storageTypes';

import { useSessionRuntimeStatusSource } from './useSessionRuntimeStatusSource';

function createSession(overrides: Partial<Session> = {}): Session {
    return {
        id: 's_runtime_source',
        seq: 1,
        encryptionMode: 'plain',
        createdAt: 1,
        updatedAt: 1,
        active: true,
        activeAt: 1,
        thinking: false,
        thinkingAt: 0,
        presence: 'online',
        accessLevel: 'edit',
        canApprovePermissions: true,
        metadataVersion: 1,
        agentStateVersion: 1,
        metadata: { path: '/tmp', host: 'localhost' },
        agentState: {},
        ...overrides,
    } as Session;
}

afterEach(() => {
    standardCleanup();
});

describe('useSessionRuntimeStatusSource', () => {
    it('wakes subscribers when applySessions updates runtime status on a stable shell session', async () => {
        const previousState = storage.getState();
        try {
            const shellSession = createSession({
                latestTurnStatus: 'completed',
                latestTurnStatusObservedAt: 1,
            });
            storage.setState((state) => ({
                ...state,
                sessions: {
                    ...state.sessions,
                    [shellSession.id]: shellSession,
                },
            }));

            const hook = await renderHook(() => useSessionRuntimeStatusSource(shellSession), {
                flushOptions: { cycles: 1, turns: 4 },
            });
            const initial = hook.getCurrent();
            expect(initial.latestTurnStatus).toBe('completed');

            await act(async () => {
                storage.getState().applySessions([{
                    ...shellSession,
                    activeAt: 2_000,
                    thinking: true,
                    thinkingAt: 2_000,
                    latestTurnStatus: 'in_progress',
                    latestTurnStatusObservedAt: 2_000,
                    presence: 'online',
                }]);
            });

            expect(hook.getCurrent()).not.toBe(initial);
            expect(hook.getCurrent()).toEqual(expect.objectContaining({
                id: shellSession.id,
                activeAt: 2_000,
                thinking: true,
                thinkingAt: 2_000,
                latestTurnStatus: 'in_progress',
                latestTurnStatusObservedAt: 2_000,
            }));

            await hook.unmount();
        } finally {
            storage.setState(previousState, true);
        }
    });
});
