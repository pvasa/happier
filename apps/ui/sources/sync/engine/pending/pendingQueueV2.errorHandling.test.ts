import { beforeEach, describe, expect, it } from 'vitest';

import { storage } from '@/sync/domains/state/storage';
import type { DiscardedPendingMessage } from '@/sync/domains/state/storageTypes';

import {
    deleteDiscardedPendingMessageV2,
    deletePendingMessageV2,
    discardPendingMessageV2,
    fetchAndApplyPendingMessagesV2,
    reorderPendingMessagesV2,
    restoreDiscardedPendingMessageV2,
    updatePendingMessageV2,
} from './pendingQueueV2';
import { buildSession, createPendingQueueEncryption, resetPendingQueueState } from './pendingQueueV2.testHelpers';

function buildDiscardedPendingMessage(): DiscardedPendingMessage {
    return {
        id: 'd1',
        localId: 'd1',
        createdAt: 1,
        updatedAt: 1,
        text: 'x',
        rawRecord: { role: 'user', content: { type: 'text', text: 'x' } },
        discardedAt: 2,
        discardedReason: 'manual',
    };
}

async function expectNotAuthenticated(promise: Promise<unknown>, status: 401 | 403): Promise<void> {
    await expect(promise).rejects.toMatchObject({
        name: 'HappyError',
        canTryAgain: false,
        kind: 'auth',
        code: 'not_authenticated',
        status,
    });
}

function insertEditablePendingMessage(sessionId: string): void {
    storage.getState().applySessions([buildSession({ sessionId })]);
    storage.getState().upsertPendingMessage(sessionId, {
        id: 'p1',
        localId: 'p1',
        createdAt: 1,
        updatedAt: 1,
        text: 'original',
        rawRecord: {
            role: 'user',
            content: { type: 'text', text: 'original' },
            meta: {},
        },
    });
}

describe('pendingQueueV2 error handling', () => {
    beforeEach(() => {
        resetPendingQueueState();
    });

    it('clears discarded messages when the pending fetch fails', async () => {
        const sessionId = 's_test';
        const encryption = await createPendingQueueEncryption({ sessionId });

        storage.getState().applyDiscardedPendingMessages(sessionId, [buildDiscardedPendingMessage()]);

        await fetchAndApplyPendingMessagesV2({
            sessionId,
            encryption,
            request: async () => new Response('nope', { status: 500 }),
        });

        const pendingState = storage.getState().sessionPending[sessionId];
        expect(pendingState?.discarded ?? []).toEqual([]);
        expect(pendingState?.isLoaded).toBe(true);
    });

    it('clears discarded messages when the pending response JSON shape is invalid', async () => {
        const sessionId = 's_test_bad_shape';
        const encryption = await createPendingQueueEncryption({ sessionId });

        storage.getState().applyDiscardedPendingMessages(sessionId, [buildDiscardedPendingMessage()]);

        await fetchAndApplyPendingMessagesV2({
            sessionId,
            encryption,
            request: async () => new Response(JSON.stringify({ pending: 'bad' }), { status: 200 }),
        });

        const pendingState = storage.getState().sessionPending[sessionId];
        expect(pendingState?.discarded ?? []).toEqual([]);
        expect(pendingState?.isLoaded).toBe(true);
    });

    it('clears discarded messages when response JSON parsing fails', async () => {
        const sessionId = 's_test_parse_fail';
        const encryption = await createPendingQueueEncryption({ sessionId, seedByte: 6 });

        storage.getState().applyDiscardedPendingMessages(sessionId, [buildDiscardedPendingMessage()]);

        await fetchAndApplyPendingMessagesV2({
            sessionId,
            encryption,
            request: async () => new Response('{', { status: 200 }),
        });

        const pendingState = storage.getState().sessionPending[sessionId];
        expect(pendingState?.discarded ?? []).toEqual([]);
        expect(pendingState?.isLoaded).toBe(true);
    });

    it.each([401, 403] as const)('surfaces pending fetch auth status %s as not_authenticated', async (status) => {
        const sessionId = `s_test_fetch_auth_${status}`;
        const encryption = await createPendingQueueEncryption({ sessionId, seedByte: 7 });
        const discarded = buildDiscardedPendingMessage();

        storage.getState().applyDiscardedPendingMessages(sessionId, [discarded]);

        await expectNotAuthenticated(
            fetchAndApplyPendingMessagesV2({
                sessionId,
                encryption,
                request: async () => new Response(null, { status }),
            }),
            status,
        );

        const pendingState = storage.getState().sessionPending[sessionId];
        expect(pendingState?.discarded ?? []).toEqual([discarded]);
        expect(pendingState?.isLoaded ?? false).toBe(false);
    });

    it.each([401, 403] as const)('surfaces pending mutation auth status %s as not_authenticated', async (status) => {
        const sessionId = `s_test_mutation_auth_${status}`;
        const encryption = await createPendingQueueEncryption({ sessionId, seedByte: 8 });
        insertEditablePendingMessage(sessionId);
        const request = async () => new Response(null, { status });

        const mutations: Array<() => Promise<void>> = [
            () => updatePendingMessageV2({ sessionId, pendingId: 'p1', text: 'new text', encryption, request }),
            () => deletePendingMessageV2({ sessionId, pendingId: 'p1', request }),
            () => discardPendingMessageV2({ sessionId, pendingId: 'p1', encryption, request }),
            () => restoreDiscardedPendingMessageV2({ sessionId, pendingId: 'p1', encryption, request }),
            () => deleteDiscardedPendingMessageV2({ sessionId, pendingId: 'p1', encryption, request }),
            () => reorderPendingMessagesV2({ sessionId, orderedLocalIds: ['p1'], encryption, request }),
        ];

        for (const runMutation of mutations) {
            await expectNotAuthenticated(runMutation(), status);
        }
    });

    it('preserves generic status errors for non-auth pending mutations', async () => {
        const sessionId = 's_test_mutation_generic_error';
        const encryption = await createPendingQueueEncryption({ sessionId, seedByte: 9 });
        insertEditablePendingMessage(sessionId);
        const request = async () => new Response(null, { status: 500 });

        const mutations: Array<{ run: () => Promise<void>; message: string }> = [
            {
                run: () => updatePendingMessageV2({ sessionId, pendingId: 'p1', text: 'new text', encryption, request }),
                message: 'Failed to update pending message (500)',
            },
            {
                run: () => deletePendingMessageV2({ sessionId, pendingId: 'p1', request }),
                message: 'Failed to delete pending message (500)',
            },
            {
                run: () => discardPendingMessageV2({ sessionId, pendingId: 'p1', encryption, request }),
                message: 'Failed to discard pending message (500)',
            },
            {
                run: () => restoreDiscardedPendingMessageV2({ sessionId, pendingId: 'p1', encryption, request }),
                message: 'Failed to restore discarded message (500)',
            },
            {
                run: () => deleteDiscardedPendingMessageV2({ sessionId, pendingId: 'p1', encryption, request }),
                message: 'Failed to delete discarded message (500)',
            },
            {
                run: () => reorderPendingMessagesV2({ sessionId, orderedLocalIds: ['p1'], encryption, request }),
                message: 'Failed to reorder pending messages (500)',
            },
        ];

        for (const mutation of mutations) {
            await expect(mutation.run()).rejects.toThrow(mutation.message);
        }
    });

    it('preserves request rejections for pending mutation timeouts', async () => {
        const sessionId = 's_test_mutation_timeout';
        const encryption = await createPendingQueueEncryption({ sessionId, seedByte: 10 });
        insertEditablePendingMessage(sessionId);
        const timeout = new Error('request timed out');

        await expect(
            discardPendingMessageV2({
                sessionId,
                pendingId: 'p1',
                encryption,
                request: async () => {
                    throw timeout;
                },
            }),
        ).rejects.toBe(timeout);
    });
});
