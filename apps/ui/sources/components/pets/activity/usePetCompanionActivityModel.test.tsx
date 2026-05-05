import { afterEach, describe, expect, it } from 'vitest';

import { createSessionFixture, renderHook, standardCleanup } from '@/dev/testkit';
import type { Message } from '@/sync/domains/messages/messageTypes';
import { storage } from '@/sync/domains/state/storageStore';
import { createReducer } from '@/sync/reducer/reducer';
import type { SessionMessages } from '@/sync/store/domains/messages';

import { usePetCompanionActivityModel } from './usePetCompanionActivityModel';

function createSessionMessages(messages: readonly Message[]): SessionMessages {
    const messagesById: Record<string, Message> = {};
    const messageIdsOldestFirst: string[] = [];
    for (const message of messages) {
        messagesById[message.id] = message;
        messageIdsOldestFirst.push(message.id);
    }

    return {
        messageIdsOldestFirst,
        messagesById,
        messagesMap: messagesById,
        reducerState: createReducer(),
        latestThinkingMessageId: null,
        latestThinkingMessageActivityAtMs: null,
        messagesVersion: messages.length,
        isLoaded: true,
    };
}

describe('usePetCompanionActivityModel', () => {
    afterEach(() => {
        standardCleanup();
    });

    it('maps real transcript failure status to failed activity', async () => {
        const previousState = storage.getState();
        const session = createSessionFixture({
            id: 'failed-session',
            active: true,
            seq: 1,
            createdAt: 1_000,
            updatedAt: 2_000,
            activeAt: 2_000,
            lastViewedSessionSeq: 1,
            thinking: false,
            thinkingAt: 0,
        });
        const failedToolMessage: Message = {
            kind: 'tool-call',
            id: 'tool-failed',
            localId: null,
            createdAt: 2_000,
            tool: {
                id: 'tool-1',
                name: 'Bash',
                state: 'error',
                input: { command: 'exit 1' },
                createdAt: 2_000,
                startedAt: 2_000,
                completedAt: 2_100,
                description: null,
                result: { error: 'Command failed' },
            },
            children: [],
        };

        try {
            storage.setState((state) => ({
                ...state,
                isDataReady: true,
                sessions: { [session.id]: session },
                sessionMessages: {
                    ...state.sessionMessages,
                    [session.id]: createSessionMessages([failedToolMessage]),
                },
            }));

            const hook = await renderHook(() => usePetCompanionActivityModel(), {
                flushOptions: { cycles: 1, turns: 4 },
            });

            expect(hook.getCurrent()).toMatchObject({
                state: 'failed',
                reason: 'failed',
                sessionId: session.id,
                trayItems: [
                    expect.objectContaining({
                        sessionId: session.id,
                        status: 'failed',
                    }),
                ],
            });

            await hook.unmount();
        } finally {
            storage.setState(previousState, true);
        }
    });

    it('aggregates failure signals across non-selected sessions', async () => {
        const previousState = storage.getState();
        const activeSession = createSessionFixture({
            id: 'active-session',
            active: true,
            seq: 1,
            createdAt: 1_000,
            updatedAt: 2_000,
            activeAt: 2_000,
            lastViewedSessionSeq: 1,
            thinking: false,
            thinkingAt: 0,
        });
        const failedSession = createSessionFixture({
            id: 'failed-session',
            active: false,
            seq: 2,
            createdAt: 1_500,
            updatedAt: 3_000,
            activeAt: 3_000,
            lastViewedSessionSeq: 2,
            thinking: false,
            thinkingAt: 0,
        });
        const failedToolMessage: Message = {
            kind: 'tool-call',
            id: 'tool-failed',
            localId: null,
            createdAt: 3_000,
            tool: {
                id: 'tool-1',
                name: 'Bash',
                state: 'error',
                input: { command: 'exit 1' },
                createdAt: 3_000,
                startedAt: 3_000,
                completedAt: 3_100,
                description: null,
                result: { error: 'Command failed' },
            },
            children: [],
        };

        try {
            storage.setState((state) => ({
                ...state,
                isDataReady: true,
                sessions: {
                    [activeSession.id]: activeSession,
                    [failedSession.id]: failedSession,
                },
                sessionMessages: {
                    ...state.sessionMessages,
                    [activeSession.id]: createSessionMessages([]),
                    [failedSession.id]: createSessionMessages([failedToolMessage]),
                },
            }));

            const hook = await renderHook(() => usePetCompanionActivityModel(), {
                flushOptions: { cycles: 1, turns: 4 },
            });

            expect(hook.getCurrent()).toMatchObject({
                state: 'failed',
                reason: 'failed',
                sessionId: failedSession.id,
            });
            expect(hook.getCurrent().trayItems.map((item) => item.sessionId)).toContain(failedSession.id);

            await hook.unmount();
        } finally {
            storage.setState(previousState, true);
        }
    });

    it('uses the newest committed transcript text as the tray subtitle', async () => {
        const previousState = storage.getState();
        const session = createSessionFixture({
            id: 'message-preview-session',
            active: true,
            seq: 1,
            createdAt: 1_000,
            updatedAt: 3_000,
            activeAt: 3_000,
            lastViewedSessionSeq: 1,
            pendingCount: 1,
            thinking: false,
            thinkingAt: 0,
        });
        const olderMessage: Message = {
            kind: 'user-text',
            id: 'message-older',
            localId: null,
            createdAt: 2_000,
            text: 'Inspect the tray card',
        };
        const latestMessage: Message = {
            kind: 'agent-text',
            id: 'message-latest',
            localId: null,
            createdAt: 3_000,
            text: 'Compact white bubbles are ready',
        };

        try {
            storage.setState((state) => ({
                ...state,
                isDataReady: true,
                sessions: { [session.id]: session },
                sessionMessages: {
                    ...state.sessionMessages,
                    [session.id]: createSessionMessages([olderMessage, latestMessage]),
                },
            }));

            const hook = await renderHook(() => usePetCompanionActivityModel(), {
                flushOptions: { cycles: 1, turns: 4 },
            });

            expect(hook.getCurrent().trayItems[0]).toMatchObject({
                sessionId: session.id,
                subtitle: 'Compact white bubbles are ready',
            });

            await hook.unmount();
        } finally {
            storage.setState(previousState, true);
        }
    });
});
