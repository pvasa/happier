import { afterEach, describe, expect, it } from 'vitest';

import type { SessionListRenderableSession } from '@/sync/domains/session/listing/sessionListRenderable';
import type { Session } from '@/sync/domains/state/storageTypes';
import { createReducer } from '@/sync/reducer/reducer';
import type { SessionMessages } from './domains/messages';
import type { SessionPending } from './domains/pending';
import {
    createSessionListRowStoreStateSelector,
    selectSessionListRowStateSnapshot,
} from './sessionListRowStateSnapshot';
import { syncPerformanceTelemetry } from '@/sync/runtime/syncPerformanceTelemetry';

function createSession(id: string): Session {
    return {
        id,
        seq: 1,
        createdAt: 10,
        updatedAt: 20,
        active: false,
        activeAt: 0,
        metadata: null,
        metadataVersion: 1,
        agentState: null,
        agentStateVersion: 1,
        thinking: false,
        thinkingAt: 0,
        presence: 'online',
    };
}

function createRenderable(id: string): SessionListRenderableSession {
    return {
        id,
        seq: 1,
        createdAt: 10,
        updatedAt: 20,
        active: false,
        activeAt: 0,
        metadata: null,
        metadataVersion: 1,
        agentStateVersion: 1,
        thinking: false,
        thinkingAt: 0,
        presence: 'online',
    };
}

const messages = {
    messageIdsOldestFirst: [],
    messagesById: {},
    messagesMap: {},
    reducerState: createReducer(),
    latestThinkingMessageId: null,
    latestThinkingMessageActivityAtMs: null,
    latestReadyEventSeq: null,
    latestReadyEventAt: null,
    messagesVersion: 1,
    isLoaded: true,
} satisfies SessionMessages;

const pending = {
    messages: [],
    discarded: [],
    isLoaded: true,
} satisfies SessionPending;

describe('selectSessionListRowStateSnapshot', () => {
    afterEach(() => {
        syncPerformanceTelemetry.configure({ enabled: false });
        syncPerformanceTelemetry.reset();
    });

    it('reads exact per-session inputs without depending on outer store map identity', () => {
        const session = createSession('s1');
        const renderable = createRenderable('s1');
        const snapshotA = selectSessionListRowStateSnapshot({
            sessions: { s1: session },
            sessionListRenderables: { s1: renderable },
            sessionMessages: { s1: messages },
            sessionPending: { s1: pending },
        }, 's1');
        const snapshotB = selectSessionListRowStateSnapshot({
            sessions: { s1: session, unrelated: createSession('unrelated') },
            sessionListRenderables: { s1: renderable },
            sessionMessages: { s1: messages },
            sessionPending: { s1: pending },
        }, 's1');

        expect(snapshotA.session).toBe(session);
        expect(snapshotB.session).toBe(session);
        expect(snapshotB.renderable).toBe(renderable);
        expect(snapshotB.messages).toBe(messages);
        expect(snapshotB.pending).toBe(pending);
    });

    it('keeps focused row store state stable when unrelated outer maps change', () => {
        const session = createSession('s1');
        const renderable = createRenderable('s1');
        const selector = createSessionListRowStoreStateSelector([{
            sessionId: 's1',
            serverId: 'server-a',
        }], 'server-a');

        const first = selector({
            sessions: { s1: session },
            sessionListRenderables: { s1: renderable },
            sessionMessages: { s1: messages },
            sessionPending: { s1: pending },
        });
        const second = selector({
            sessions: { s1: createSession('s1'), unrelated: createSession('unrelated') },
            sessionListRenderables: { s1: renderable },
            sessionMessages: { s1: messages },
            sessionPending: { s1: pending },
        });
        const changedMessages = {
            ...messages,
            messagesVersion: messages.messagesVersion + 1,
        };
        const third = selector({
            sessions: { s1: session, unrelated: createSession('unrelated') },
            sessionListRenderables: { s1: renderable },
            sessionMessages: { s1: changedMessages },
            sessionPending: { s1: pending },
        });

        expect(second).toBe(first);
        expect(third).toBe(first);
        expect(first.sessions?.s1).toBeUndefined();
        expect(third.sessionMessages?.s1).toBeUndefined();

        const selectorWithoutRenderable = createSessionListRowStoreStateSelector([{
            sessionId: 's1',
            serverId: 'server-a',
        }], 'server-a');
        const firstWithoutRenderable = selectorWithoutRenderable({
            sessions: { s1: session },
            sessionListRenderables: {},
            sessionMessages: { s1: messages },
            sessionPending: { s1: pending },
        });
        const secondWithoutRenderable = selectorWithoutRenderable({
            sessions: { s1: session },
            sessionListRenderables: {},
            sessionMessages: { s1: changedMessages },
            sessionPending: { s1: pending },
        });

        expect(secondWithoutRenderable).not.toBe(firstWithoutRenderable);
        expect(secondWithoutRenderable.sessionMessages?.s1).toBe(changedMessages);
    });

    it('records why the row-store selector output changed when telemetry is enabled', () => {
        syncPerformanceTelemetry.configure({
            enabled: true,
            slowThresholdMs: 1_000_000,
            flushIntervalMs: 60_000,
        });
        syncPerformanceTelemetry.reset();
        const session = createSession('s1');
        const selector = createSessionListRowStoreStateSelector([{
            sessionId: 's1',
            serverId: 'server-a',
        }], 'server-a');

        selector({
            sessions: { s1: session },
            sessionListRenderables: {},
            sessionMessages: { s1: messages },
            sessionPending: { s1: pending },
        });
        syncPerformanceTelemetry.reset();

        selector({
            sessions: { s1: createSession('s1') },
            sessionListRenderables: {},
            sessionMessages: { s1: messages },
            sessionPending: { s1: pending },
        });

        const event = syncPerformanceTelemetry
            .snapshot()
            .events.find((entry) => entry.name === 'ui.sessionsList.rowStoreSelector.changed');
        expect(event?.fields).toEqual(expect.objectContaining({
            scopedRows: 1,
            changedSessions: 1,
            changedRenderables: 0,
            changedMessages: 0,
            changedPending: 0,
        }));
    });

    it('applies active-server overlays only to matching duplicate session ids', () => {
        const session = createSession('shared');
        const renderable = createRenderable('shared');
        const state = {
            activeServerId: 'server-a',
            sessions: { shared: session },
            sessionListRenderables: { shared: renderable },
            sessionMessages: { shared: messages },
            sessionPending: { shared: pending },
        };

        const activeServerSnapshot = selectSessionListRowStateSnapshot(state, {
            sessionId: 'shared',
            serverId: 'server-a',
        });
        const otherServerSnapshot = selectSessionListRowStateSnapshot(state, {
            sessionId: 'shared',
            serverId: 'server-b',
        });

        expect(activeServerSnapshot.session).toBe(session);
        expect(activeServerSnapshot.renderable).toBe(renderable);
        expect(activeServerSnapshot.messages).toBe(messages);
        expect(activeServerSnapshot.pending).toBe(pending);
        expect(otherServerSnapshot.session).toBeUndefined();
        expect(otherServerSnapshot.renderable).toBeUndefined();
        expect(otherServerSnapshot.messages).toBeUndefined();
        expect(otherServerSnapshot.pending).toBeUndefined();
    });
});
