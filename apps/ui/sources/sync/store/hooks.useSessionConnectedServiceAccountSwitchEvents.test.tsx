import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react-test-renderer';

import { renderHook, standardCleanup } from '@/dev/testkit';

import { useSessionConnectedServiceAccountSwitchEvents } from '@/sync/domains/state/storage';
import { storage } from '@/sync/domains/state/storageStore';
import type { Message } from '@/sync/domains/messages/messageTypes';

afterEach(() => {
    standardCleanup();
});

function seedSessionMessages(sessionId: string, messagesById: Record<string, Message>, ids: string[]): void {
    storage.setState((state) => ({
        ...state,
        sessionMessages: {
            ...state.sessionMessages,
            [sessionId]: {
                messageIdsOldestFirst: ids,
                messagesById,
                messagesMap: messagesById,
                reducerState: {} as any,
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
}

describe('useSessionConnectedServiceAccountSwitchEvents', () => {
    it('does not reread transcript messages on unrelated store publishes', async () => {
        const previousState = storage.getState();
        try {
            let kindReadCount = 0;
            const eventMessage = {
                id: 'event-1',
                localId: null,
                createdAt: 10,
                get kind() {
                    kindReadCount += 1;
                    return 'agent-event';
                },
                event: {
                    type: 'connected-service-account-switch',
                    mode: 'switch',
                    reason: 'user',
                },
            } as unknown as Message;
            seedSessionMessages('s-1', { 'event-1': eventMessage }, ['event-1']);

            const hook = await renderHook(
                () => useSessionConnectedServiceAccountSwitchEvents('s-1'),
                { flushOptions: { cycles: 1, turns: 4 } },
            );
            expect(hook.getCurrent()).toHaveLength(1);
            expect(kindReadCount).toBeGreaterThan(0);

            kindReadCount = 0;
            await act(async () => {
                storage.setState((state) => ({
                    ...state,
                    realtimeStatus: state.realtimeStatus === 'connected' ? 'disconnected' : 'connected',
                }));
            });

            expect(hook.getCurrent()).toHaveLength(1);
            expect(kindReadCount).toBe(0);

            await hook.unmount();
        } finally {
            storage.setState(previousState);
        }
    });
});
