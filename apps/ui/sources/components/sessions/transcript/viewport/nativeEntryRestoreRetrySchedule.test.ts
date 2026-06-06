import { describe, expect, it } from 'vitest';

import { resolveNativeEntryRestoreRetrySchedule } from './nativeEntryRestoreRetrySchedule';

describe('native entry restore retry schedule', () => {
    it('schedules the first restore retry after the throttle interval', () => {
        expect(resolveNativeEntryRestoreRetrySchedule(null, {
            lastRetryAtMs: Number.NEGATIVE_INFINITY,
            minIntervalMs: 200,
            nowMs: 1000,
            offsetY: 355,
            retryAttempt: 0,
            retryLimit: 3,
            sessionId: 'session-a',
        })).toEqual({
            action: 'replace',
            dueAtMs: 1000,
        });
    });

    it('keeps an existing same-session same-offset retry', () => {
        expect(resolveNativeEntryRestoreRetrySchedule({
            dueAtMs: 1250,
            offsetY: 355,
            sessionId: 'session-a',
        }, {
            lastRetryAtMs: 900,
            minIntervalMs: 200,
            nowMs: 1000,
            offsetY: 355,
            retryAttempt: 1,
            retryLimit: 3,
            sessionId: 'session-a',
        })).toEqual({
            action: 'keep-existing',
            dueAtMs: 1250,
        });
    });

    it('replaces a retry for a different restore offset', () => {
        expect(resolveNativeEntryRestoreRetrySchedule({
            dueAtMs: 1250,
            offsetY: 355,
            sessionId: 'session-a',
        }, {
            lastRetryAtMs: 900,
            minIntervalMs: 200,
            nowMs: 1000,
            offsetY: 620,
            retryAttempt: 1,
            retryLimit: 3,
            sessionId: 'session-a',
        })).toEqual({
            action: 'replace',
            dueAtMs: 1101,
        });
    });

    it('skips requests that exhausted the retry limit', () => {
        expect(resolveNativeEntryRestoreRetrySchedule(null, {
            lastRetryAtMs: 900,
            minIntervalMs: 200,
            nowMs: 1000,
            offsetY: 355,
            retryAttempt: 3,
            retryLimit: 3,
            sessionId: 'session-a',
        })).toEqual({
            action: 'skip',
            reason: 'retry-limit',
        });
    });
});
