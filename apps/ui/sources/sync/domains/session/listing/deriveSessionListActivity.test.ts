import { describe, expect, it } from 'vitest';

import {
    deriveSessionListAttentionState,
    deriveSessionListMeaningfulActivityAt,
    resolveSessionListSecondaryLineMode,
} from './deriveSessionListActivity';
import type { PrimaryTurnStatusV1, SessionRuntimeIssueV1 } from '@happier-dev/protocol';

const runtimeIssue: SessionRuntimeIssueV1 = {
    v: 1,
    scope: 'primary_session',
    status: 'failed',
    code: 'auth_error',
    source: 'auth_error',
    occurredAt: 123,
    sanitizedPreview: 'Authentication failed',
};

describe('deriveSessionListMeaningfulActivityAt', () => {
    it('prefers real transcript activity over session updatedAt churn', () => {
        const result = deriveSessionListMeaningfulActivityAt({
            sessionCreatedAt: 100,
            latestCommittedMessageCreatedAt: 1_200,
            latestThinkingActivityAt: null,
            latestPendingMessageCreatedAt: null,
        });

        expect(result).toBe(1_200);
    });

    it('ignores live thinking heartbeats so session-list recency stays stable during streaming', () => {
        const result = deriveSessionListMeaningfulActivityAt({
            sessionCreatedAt: 100,
            latestCommittedMessageCreatedAt: 1_200,
            latestThinkingActivityAt: 1_800,
            latestPendingMessageCreatedAt: null,
        });

        expect(result).toBe(1_200);
    });

    it('falls back to the session createdAt when there is no transcript activity', () => {
        const result = deriveSessionListMeaningfulActivityAt({
            sessionCreatedAt: 321,
            latestCommittedMessageCreatedAt: null,
            latestThinkingActivityAt: null,
            latestPendingMessageCreatedAt: null,
        });

        expect(result).toBe(321);
    });
});

describe('resolveSessionListSecondaryLineMode', () => {
    it('uses status mode for project-grouped rows', () => {
        expect(resolveSessionListSecondaryLineMode({ groupKind: 'project' })).toBe('status');
    });

    it('uses path mode for date-grouped rows', () => {
        expect(resolveSessionListSecondaryLineMode({ groupKind: 'date' })).toBe('path');
    });
});

describe('deriveSessionListAttentionState', () => {
    function input(overrides: Partial<Parameters<typeof deriveSessionListAttentionState>[0]> & {
        latestTurnStatus?: PrimaryTurnStatusV1 | null;
        lastRuntimeIssue?: SessionRuntimeIssueV1 | null;
        latestReadyEventSeq?: number | null;
        latestReadyEventAt?: number | null;
        lastViewedSessionSeq?: number | null;
    } = {}) {
        return {
            hasUnreadMessages: false,
            pendingCount: 0,
            sessionState: 'waiting' as const,
            ...overrides,
        };
    }

    it('marks unread sessions as needing emphasis even when otherwise quiet', () => {
        expect(deriveSessionListAttentionState(input({ hasUnreadMessages: true }))).toBe('unread');
    });

    it('preserves explicit permission-required attention over generic unread state', () => {
        expect(deriveSessionListAttentionState(input({
            hasUnreadMessages: true,
            sessionState: 'permission_required',
        }))).toBe('permission_required');
    });

    it('treats pending queue activity as an attention state', () => {
        expect(deriveSessionListAttentionState(input({ pendingCount: 2 }))).toBe('pending');
    });

    it('treats resuming sessions as active attention before generic pending activity', () => {
        expect(deriveSessionListAttentionState(input({
            pendingCount: 2,
            sessionState: 'resuming',
        }))).toBe('thinking');
    });

    it('prioritizes failed primary turns over every other attention source', () => {
        expect(deriveSessionListAttentionState(input({
            latestTurnStatus: 'failed',
            lastRuntimeIssue: runtimeIssue,
            sessionState: 'action_required',
            pendingCount: 2,
            hasUnreadMessages: true,
            latestReadyEventSeq: 10,
            lastViewedSessionSeq: 1,
        }))).toBe('failed');
    });

    it('prioritizes action and permission blockers over working and ready', () => {
        expect(deriveSessionListAttentionState(input({
            sessionState: 'action_required',
            latestTurnStatus: 'in_progress',
            latestReadyEventSeq: 10,
            lastViewedSessionSeq: 1,
        }))).toBe('action_required');

        expect(deriveSessionListAttentionState(input({
            sessionState: 'permission_required',
            latestTurnStatus: 'in_progress',
            latestReadyEventSeq: 10,
            lastViewedSessionSeq: 1,
        }))).toBe('permission_required');
    });

    it('prioritizes active turn work over stale ready markers', () => {
        expect(deriveSessionListAttentionState(input({
            sessionState: 'thinking',
            latestReadyEventSeq: 10,
            lastViewedSessionSeq: 1,
        }))).toBe('thinking');
    });

    it('marks ready only when the latest ready seq is newer than the read cursor', () => {
        expect(deriveSessionListAttentionState(input({
            hasUnreadMessages: true,
            latestReadyEventSeq: 10,
            lastViewedSessionSeq: 9,
        }))).toBe('ready');

        expect(deriveSessionListAttentionState(input({
            hasUnreadMessages: true,
            latestReadyEventSeq: 10,
            lastViewedSessionSeq: 10,
        }))).toBe('unread');
    });

    it('prioritizes ready over pending and pending over generic unread', () => {
        expect(deriveSessionListAttentionState(input({
            pendingCount: 2,
            hasUnreadMessages: true,
            latestReadyEventSeq: 10,
            lastViewedSessionSeq: 1,
        }))).toBe('ready');

        expect(deriveSessionListAttentionState(input({
            pendingCount: 2,
            hasUnreadMessages: true,
        }))).toBe('pending');
    });
});
