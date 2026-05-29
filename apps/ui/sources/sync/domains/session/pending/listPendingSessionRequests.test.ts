import { describe, expect, it } from 'vitest';
import { createSessionFixture } from '@/dev/testkit/fixtures/sessionFixtures';
import type { Message } from '@/sync/domains/messages/messageTypes';
import {
    deriveLatestPendingRequestObservedAtFromSession,
    derivePendingRequestFlagsFromSession,
    listPendingSessionRequests,
    shouldReadTranscriptForPendingSessionRequests,
} from './listPendingSessionRequests';

describe('derivePendingRequestFlagsFromSession', () => {
    it('uses projected pending request counts without scanning large transcript message lists', () => {
        const messages: Message[] = Array.from({ length: 1_000 }, (_, index) => ({
            id: `msg-${index}`,
            kind: 'tool-call',
            localId: null,
            createdAt: index + 1,
            tool: {
                id: `tool-${index}`,
                name: 'bash',
                state: 'running',
                input: {},
                createdAt: index + 1,
                startedAt: index + 1,
                completedAt: null,
                description: null,
                permission: {
                    id: `permission-${index}`,
                    status: 'pending',
                },
            },
            children: [],
        }));

        const session = createSessionFixture({
            active: true,
            updatedAt: 10_000,
            agentState: {
                requests: {},
                completedRequests: null,
            },
            pendingPermissionRequestCount: 0,
            pendingUserActionRequestCount: 0,
        });

        expect(derivePendingRequestFlagsFromSession(session, messages)).toEqual({
            hasPendingPermissionRequests: false,
            hasPendingUserActionRequests: false,
        });
    });

    it('prefers projected counts over stale agent state request details', () => {
        const session = createSessionFixture({
            active: true,
            agentState: {
                requests: {
                    stale_request: {
                        tool: 'bash',
                        arguments: {},
                        createdAt: 10,
                    },
                },
                completedRequests: null,
            },
            pendingPermissionRequestCount: 0,
            pendingUserActionRequestCount: 1,
        });

        expect(derivePendingRequestFlagsFromSession(session)).toEqual({
            hasPendingPermissionRequests: false,
            hasPendingUserActionRequests: true,
        });
    });

    it('prefers projected observed timestamp over request detail timestamps', () => {
        const session = createSessionFixture({
            active: true,
            pendingRequestObservedAt: 25,
            pendingPermissionRequestCount: 1,
            pendingUserActionRequestCount: 0,
            agentState: {
                requests: {
                    stale_request: {
                        tool: 'bash',
                        arguments: {},
                        createdAt: 100,
                    },
                },
                completedRequests: null,
            },
        });

        expect(deriveLatestPendingRequestObservedAtFromSession(session)).toBe(25);
    });

    it('does not read transcript details when projected counts say nothing is pending', () => {
        const session = createSessionFixture({
            active: true,
            pendingPermissionRequestCount: 0,
            pendingUserActionRequestCount: 0,
            agentState: {
                requests: {
                    stale_request: {
                        tool: 'bash',
                        arguments: {},
                        createdAt: 100,
                    },
                },
                completedRequests: null,
            },
        });

        expect(shouldReadTranscriptForPendingSessionRequests(session)).toBe(false);
        expect(listPendingSessionRequests(session)).toEqual([]);
    });

    it('suppresses a stale projected pending flag when a newer hard-terminal transcript outcome exists', () => {
        // Projection still says a permission is pending, but the transcript shows
        // the request was hard-resolved (approved) AFTER the projection was observed.
        const messages: Message[] = [{
            id: 'msg-1',
            kind: 'tool-call',
            localId: null,
            createdAt: 200,
            tool: {
                id: 'tool-1',
                name: 'bash',
                state: 'completed',
                input: {},
                createdAt: 200,
                startedAt: 200,
                completedAt: 200,
                description: null,
                result: { output: 'done' },
                permission: {
                    id: 'permission-1',
                    status: 'approved',
                },
            },
            children: [],
        }] as unknown as Message[];

        const session = createSessionFixture({
            active: true,
            updatedAt: 100,
            pendingPermissionRequestCount: 1,
            pendingUserActionRequestCount: 0,
            pendingRequestObservedAt: 100,
            agentState: {
                requests: {},
                completedRequests: null,
            },
        });

        expect(derivePendingRequestFlagsFromSession(session, messages)).toEqual({
            hasPendingPermissionRequests: false,
            hasPendingUserActionRequests: false,
        });
        expect(deriveLatestPendingRequestObservedAtFromSession(session, messages)).toBeNull();
        expect(listPendingSessionRequests(session, messages)).toEqual([]);
    });

    it('still surfaces a genuinely pending request that has no newer hard-terminal transcript outcome', () => {
        // Projection says a permission is pending and the transcript agrees (still pending).
        const messages: Message[] = [{
            id: 'msg-1',
            kind: 'tool-call',
            localId: null,
            createdAt: 200,
            tool: {
                id: 'tool-1',
                name: 'bash',
                state: 'running',
                input: {},
                createdAt: 200,
                startedAt: 200,
                completedAt: null,
                description: null,
                permission: {
                    id: 'permission-1',
                    status: 'pending',
                },
            },
            children: [],
        }] as unknown as Message[];

        const session = createSessionFixture({
            active: true,
            updatedAt: 100,
            pendingPermissionRequestCount: 1,
            pendingUserActionRequestCount: 0,
            pendingRequestObservedAt: 100,
            agentState: {
                requests: {},
                completedRequests: null,
            },
        });

        expect(derivePendingRequestFlagsFromSession(session, messages)).toEqual({
            hasPendingPermissionRequests: true,
            hasPendingUserActionRequests: false,
        });
        expect(deriveLatestPendingRequestObservedAtFromSession(session, messages)).toBe(100);
        expect(listPendingSessionRequests(session, messages)).toHaveLength(1);
    });

    it('does not suppress projected pending when the only hard-terminal outcome predates the projection', () => {
        // The hard-terminal resolution happened BEFORE updatedAt, so it cannot
        // explain away a still-projected pending request; trust the projection.
        const messages: Message[] = [{
            id: 'msg-1',
            kind: 'tool-call',
            localId: null,
            createdAt: 50,
            tool: {
                id: 'tool-1',
                name: 'bash',
                state: 'completed',
                input: {},
                createdAt: 50,
                startedAt: 50,
                completedAt: 50,
                description: null,
                result: { output: 'done' },
                permission: {
                    id: 'permission-1',
                    status: 'approved',
                },
            },
            children: [],
        }] as unknown as Message[];

        const session = createSessionFixture({
            active: true,
            updatedAt: 100,
            pendingPermissionRequestCount: 1,
            pendingUserActionRequestCount: 0,
            pendingRequestObservedAt: 100,
            agentState: {
                requests: {},
                completedRequests: null,
            },
        });

        expect(derivePendingRequestFlagsFromSession(session, messages)).toEqual({
            hasPendingPermissionRequests: true,
            hasPendingUserActionRequests: false,
        });
        expect(deriveLatestPendingRequestObservedAtFromSession(session, messages)).toBe(100);
    });
});
