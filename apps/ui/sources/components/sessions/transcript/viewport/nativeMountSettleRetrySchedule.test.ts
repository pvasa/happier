import { describe, expect, it } from 'vitest';

import { resolveNativeMountSettleRetrySchedule } from './nativeMountSettleRetrySchedule';

describe('native mount-settle retry schedule', () => {
    it('schedules the first retry request', () => {
        expect(resolveNativeMountSettleRetrySchedule(null, {
            sessionId: 'session-a',
            nowMs: 100,
            delayMs: 200,
        })).toEqual({
            action: 'replace',
            dueAtMs: 300,
        });
    });

    it('keeps an existing same-session retry when it fires sooner', () => {
        expect(resolveNativeMountSettleRetrySchedule({
            sessionId: 'session-a',
            dueAtMs: 250,
        }, {
            sessionId: 'session-a',
            nowMs: 100,
            delayMs: 200,
        })).toEqual({
            action: 'keep-existing',
            dueAtMs: 250,
        });
    });

    it('replaces an existing same-session retry when new evidence needs an earlier correction', () => {
        expect(resolveNativeMountSettleRetrySchedule({
            sessionId: 'session-a',
            dueAtMs: 450,
        }, {
            sessionId: 'session-a',
            nowMs: 100,
            delayMs: 0,
        })).toEqual({
            action: 'replace',
            dueAtMs: 100,
        });
    });

    it('replaces a retry from a previous session', () => {
        expect(resolveNativeMountSettleRetrySchedule({
            sessionId: 'session-a',
            dueAtMs: 250,
        }, {
            sessionId: 'session-b',
            nowMs: 100,
            delayMs: 200,
        })).toEqual({
            action: 'replace',
            dueAtMs: 300,
        });
    });
});
