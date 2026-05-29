import { beforeEach, describe, expect, it } from 'vitest';

import { deriveSessionReadState, resolveSessionReadStateAction } from './sessionReadState';
import type { StorageState } from '@/sync/store/types';

const storageState = {
    sessionMessages: {},
} as unknown as StorageState;

beforeEach(async () => {
    (storageState as { sessionMessages: Record<string, unknown> }).sessionMessages = {};
    const { registerStorageStateReader } = await import('@/sync/domains/state/storageStateReaderBridge');
    registerStorageStateReader(() => storageState);
});

describe('sessionReadState', () => {
    it('derives empty state when a session has no committed activity', () => {
        expect(deriveSessionReadState({ seq: 0, lastViewedSessionSeq: null, metadata: null })).toBe('empty');
        expect(resolveSessionReadStateAction({ seq: 0, lastViewedSessionSeq: null, metadata: null })).toEqual({
            kind: 'none',
            visible: false,
        });
    });

    it('ignores non-terminal raw session seq when deriving read-state actions', () => {
        const session = {
            id: 's_raw',
            seq: 3,
            lastViewedSessionSeq: 2,
            latestTurnStatus: 'in_progress' as const,
            metadata: null,
        };

        expect(deriveSessionReadState(session)).toBe('empty');
        expect(resolveSessionReadStateAction(session)).toEqual({
            kind: 'none',
            visible: false,
        });
    });

    it('derives unread state from a committed stored message and offers mark-read', () => {
        (storageState as { sessionMessages: Record<string, unknown> }).sessionMessages = {
            s_message: {
                messageIdsOldestFirst: ['m3'],
                messagesById: {
                    m3: {
                        id: 'm3',
                        seq: 3,
                        localId: null,
                        kind: 'agent-text',
                        text: 'done',
                        createdAt: 100,
                    },
                },
            },
        };
        const session = {
            id: 's_message',
            seq: 9,
            lastViewedSessionSeq: 2,
            latestTurnStatus: 'in_progress' as const,
            metadata: null,
        };

        expect(deriveSessionReadState(session)).toBe('unread');
        expect(resolveSessionReadStateAction(session)).toEqual({
            kind: 'mark-read',
            visible: true,
            targetState: 'read',
        });
    });

    it('derives unread state from a ready event and offers mark-read', () => {
        const session = {
            seq: 3,
            lastViewedSessionSeq: 2,
            latestReadyEventSeq: 3,
            latestTurnStatus: 'in_progress' as const,
            metadata: null,
        };

        expect(deriveSessionReadState(session)).toBe('unread');
        expect(resolveSessionReadStateAction(session)).toEqual({
            kind: 'mark-read',
            visible: true,
            targetState: 'read',
        });
    });

    it('derives read state from a current cursor and offers mark-unread', () => {
        const session = {
            seq: 3,
            lastViewedSessionSeq: 3,
            latestTurnStatus: 'completed' as const,
            metadata: null,
        };

        expect(deriveSessionReadState(session)).toBe('read');
        expect(resolveSessionReadStateAction(session)).toEqual({
            kind: 'mark-unread',
            visible: true,
            targetState: 'unread',
        });
    });

    it('falls back to legacy readStateV1 when the top-level cursor is missing', () => {
        const session = {
            seq: 3,
            lastViewedSessionSeq: null,
            latestTurnStatus: 'completed' as const,
            metadata: {
                path: '/repo',
                host: 'localhost',
                readStateV1: { v: 1 as const, sessionSeq: 3, pendingActivityAt: 0, updatedAt: 1 },
            },
        };

        expect(deriveSessionReadState(session)).toBe('read');
        expect(resolveSessionReadStateAction(session)).toEqual({
            kind: 'mark-unread',
            visible: true,
            targetState: 'unread',
        });
    });

    it('hides manual read-state actions for view-only shared sessions', () => {
        const session = {
            seq: 3,
            lastViewedSessionSeq: 2,
            latestTurnStatus: 'completed' as const,
            metadata: null,
            accessLevel: 'view' as const,
        };

        expect(deriveSessionReadState(session)).toBe('unread');
        expect(resolveSessionReadStateAction(session)).toEqual({
            kind: 'none',
            visible: false,
        });
    });
});
