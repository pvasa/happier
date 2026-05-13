import { describe, expect, it } from 'vitest';

import { deriveSessionAttentionState } from './deriveSessionAttentionState';

const runtimeIssue = {
    v: 1,
    scope: 'primary_session',
    status: 'failed',
    code: 'auth_error',
    source: 'auth_error',
    occurredAt: 123,
    sanitizedPreview: 'Authentication failed',
} as const;

describe('deriveSessionAttentionState', () => {
    it('returns running for in-progress primary turns', () => {
        expect(deriveSessionAttentionState({
            latestTurnStatus: 'in_progress',
            lastRuntimeIssue: null,
        })).toBe('running');
    });

    it('lets in-progress turns override stale runtime issues', () => {
        expect(deriveSessionAttentionState({
            latestTurnStatus: 'in_progress',
            lastRuntimeIssue: runtimeIssue,
        })).toBe('running');
    });

    it('returns failed when the latest primary turn failed with a runtime issue', () => {
        expect(deriveSessionAttentionState({
            latestTurnStatus: 'failed',
            lastRuntimeIssue: runtimeIssue,
        })).toBe('failed');
    });

    it('does not keep failed attention after a later completed turn', () => {
        expect(deriveSessionAttentionState({
            latestTurnStatus: 'completed',
            lastRuntimeIssue: runtimeIssue,
        })).toBe('idle');
    });
});
