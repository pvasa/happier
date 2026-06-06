import { describe, expect, it } from 'vitest';

import {
    appendNativeBottomFollowContentChangeCandidate,
    appendNativeBottomFollowStaleObservationCandidate,
    filterRecentNativeBottomFollowContentChangeCandidates,
    filterRecentNativeBottomFollowStaleObservationCandidates,
    nativeBottomFollowCanApplyCompletion,
    nativeBottomFollowCanCompletePendingPin,
    nativeBottomFollowContentChangeObservationMatches,
    nativeBottomFollowPinTargetObserved,
    nativeBottomFollowShouldRecordTargetConfirmation,
    nativeBottomFollowStaleObservationMatches,
} from './nativeBottomFollowObservationPolicy';

describe('native bottom-follow observation policy', () => {
    it('matches stale observations by session and nearby bottom distance', () => {
        expect(nativeBottomFollowStaleObservationMatches({
            distanceFromBottom: 42,
            observedAtMs: 1000,
            offsetY: 350,
            sessionId: 'session-a',
        }, {
            distanceFromBottom: 50,
            offsetY: 999,
            pinThresholdPx: 10,
            sessionId: 'session-a',
        })).toBe(true);
    });

    it('matches stale observations by session and nearby scroll offset', () => {
        expect(nativeBottomFollowStaleObservationMatches({
            distanceFromBottom: 240,
            observedAtMs: 1000,
            offsetY: 350,
            sessionId: 'session-a',
        }, {
            distanceFromBottom: 50,
            offsetY: 358,
            pinThresholdPx: 10,
            sessionId: 'session-a',
        })).toBe(true);
    });

    it('does not match stale observations from another session or outside tolerance', () => {
        expect(nativeBottomFollowStaleObservationMatches({
            distanceFromBottom: 42,
            observedAtMs: 1000,
            offsetY: 350,
            sessionId: 'session-a',
        }, {
            distanceFromBottom: 50,
            offsetY: 358,
            pinThresholdPx: 10,
            sessionId: 'session-b',
        })).toBe(false);

        expect(nativeBottomFollowStaleObservationMatches({
            distanceFromBottom: 42,
            observedAtMs: 1000,
            offsetY: 350,
            sessionId: 'session-a',
        }, {
            distanceFromBottom: 80,
            offsetY: 390,
            pinThresholdPx: 10,
            sessionId: 'session-a',
        })).toBe(false);
    });

    it('matches content-change observations by session and delta-height tolerance', () => {
        expect(nativeBottomFollowContentChangeObservationMatches({
            deltaHeightPx: 48,
            measuredAtMs: 1000,
            sessionId: 'session-a',
        }, {
            distanceFromBottom: 50,
            pinThresholdPx: 1,
            sessionId: 'session-a',
        })).toBe(true);
    });

    it('uses the pinned threshold as content-change tolerance when larger than two pixels', () => {
        expect(nativeBottomFollowContentChangeObservationMatches({
            deltaHeightPx: 60,
            measuredAtMs: 1000,
            sessionId: 'session-a',
        }, {
            distanceFromBottom: 50,
            pinThresholdPx: 12,
            sessionId: 'session-a',
        })).toBe(true);
    });

    it('does not match content-change observations from another session or outside tolerance', () => {
        expect(nativeBottomFollowContentChangeObservationMatches({
            deltaHeightPx: 48,
            measuredAtMs: 1000,
            sessionId: 'session-a',
        }, {
            distanceFromBottom: 50,
            pinThresholdPx: 4,
            sessionId: 'session-b',
        })).toBe(false);

        expect(nativeBottomFollowContentChangeObservationMatches({
            deltaHeightPx: 70,
            measuredAtMs: 1000,
            sessionId: 'session-a',
        }, {
            distanceFromBottom: 50,
            pinThresholdPx: 12,
            sessionId: 'session-a',
        })).toBe(false);
    });

    it('filters stale-observation candidates by session and recency', () => {
        const candidates = filterRecentNativeBottomFollowStaleObservationCandidates([
            { distanceFromBottom: 40, observedAtMs: 700, offsetY: 10, sessionId: 'session-a' },
            { distanceFromBottom: 42, observedAtMs: 910, offsetY: 12, sessionId: 'session-b' },
            { distanceFromBottom: 44, observedAtMs: 930, offsetY: 14, sessionId: 'session-a' },
        ], {
            nowMs: 1000,
            recentWindowMs: 100,
            sessionId: 'session-a',
        });

        expect(candidates).toEqual([
            { distanceFromBottom: 44, observedAtMs: 930, offsetY: 14, sessionId: 'session-a' },
        ]);
    });

    it('appends stale-observation candidates with a bounded tail', () => {
        const candidates = appendNativeBottomFollowStaleObservationCandidate([
            { distanceFromBottom: 40, observedAtMs: 900, offsetY: 10, sessionId: 'session-a' },
            { distanceFromBottom: 42, observedAtMs: 920, offsetY: 12, sessionId: 'session-a' },
        ], {
            distanceFromBottom: 44,
            observedAtMs: 940,
            offsetY: 14,
            sessionId: 'session-a',
        }, {
            maxCandidates: 2,
        });

        expect(candidates).toEqual([
            { distanceFromBottom: 42, observedAtMs: 920, offsetY: 12, sessionId: 'session-a' },
            { distanceFromBottom: 44, observedAtMs: 940, offsetY: 14, sessionId: 'session-a' },
        ]);
    });

    it('filters content-change candidates by session and recency', () => {
        const candidates = filterRecentNativeBottomFollowContentChangeCandidates([
            { deltaHeightPx: 40, measuredAtMs: 700, sessionId: 'session-a' },
            { deltaHeightPx: 42, measuredAtMs: 910, sessionId: 'session-b' },
            { deltaHeightPx: 44, measuredAtMs: 930, sessionId: 'session-a' },
        ], {
            nowMs: 1000,
            recentWindowMs: 100,
            sessionId: 'session-a',
        });

        expect(candidates).toEqual([
            { deltaHeightPx: 44, measuredAtMs: 930, sessionId: 'session-a' },
        ]);
    });

    it('appends content-change candidates with a bounded tail', () => {
        const candidates = appendNativeBottomFollowContentChangeCandidate([
            { deltaHeightPx: 40, measuredAtMs: 900, sessionId: 'session-a' },
            { deltaHeightPx: 42, measuredAtMs: 920, sessionId: 'session-a' },
        ], {
            deltaHeightPx: 44,
            measuredAtMs: 940,
            sessionId: 'session-a',
        }, {
            maxCandidates: 2,
        });

        expect(candidates).toEqual([
            { deltaHeightPx: 42, measuredAtMs: 920, sessionId: 'session-a' },
            { deltaHeightPx: 44, measuredAtMs: 940, sessionId: 'session-a' },
        ]);
    });

    it('observes pending bottom-pin targets by threshold distance or clamped overshoot', () => {
        expect(nativeBottomFollowPinTargetObserved({
            lastNativePinOffset: 1000,
            pinThresholdPx: 12,
            visualBottomScrollOffset: 990,
        })).toBe(true);

        expect(nativeBottomFollowPinTargetObserved({
            lastNativePinOffset: 1000,
            pinThresholdPx: 12,
            visualBottomScrollOffset: 1300,
        })).toBe(false);

        expect(nativeBottomFollowPinTargetObserved({
            lastNativePinOffset: 1000,
            pinThresholdPx: 12,
            visualBottomScrollOffset: null,
        })).toBe(false);
    });

    it('allows pending bottom-follow completion when settle is stable, deadline reached, no pin is pending, or the target was observed', () => {
        expect(nativeBottomFollowCanCompletePendingPin({
            mountSettleDeadlineReached: false,
            mountSettleStable: false,
            pendingBottomPin: true,
            pinTargetObserved: false,
        })).toBe(false);

        expect(nativeBottomFollowCanCompletePendingPin({
            mountSettleDeadlineReached: false,
            mountSettleStable: true,
            pendingBottomPin: true,
            pinTargetObserved: false,
        })).toBe(true);

        expect(nativeBottomFollowCanCompletePendingPin({
            mountSettleDeadlineReached: false,
            mountSettleStable: false,
            pendingBottomPin: false,
            pinTargetObserved: false,
        })).toBe(true);

        expect(nativeBottomFollowCanCompletePendingPin({
            mountSettleDeadlineReached: false,
            mountSettleStable: false,
            pendingBottomPin: true,
            pinTargetObserved: true,
        })).toBe(true);
    });

    it('records target confirmation for observed targets or untrusted stale native observations', () => {
        expect(nativeBottomFollowShouldRecordTargetConfirmation({
            hasStaleObservationCandidate: false,
            isTrusted: true,
            pinTargetObserved: true,
            usesNativeBottomMaintenance: true,
            wantsPinned: false,
        })).toBe(true);

        expect(nativeBottomFollowShouldRecordTargetConfirmation({
            hasStaleObservationCandidate: true,
            isTrusted: false,
            pinTargetObserved: false,
            usesNativeBottomMaintenance: true,
            wantsPinned: true,
        })).toBe(true);

        expect(nativeBottomFollowShouldRecordTargetConfirmation({
            hasStaleObservationCandidate: true,
            isTrusted: true,
            pinTargetObserved: false,
            usesNativeBottomMaintenance: true,
            wantsPinned: true,
        })).toBe(false);
    });

    it('applies native bottom-follow completion only when pinned, at bottom, and completion is allowed', () => {
        expect(nativeBottomFollowCanApplyCompletion({
            canCompletePendingPin: true,
            distanceFromBottom: 8,
            isNative: true,
            pinThresholdPx: 10,
            wantsPinned: true,
        })).toBe(true);

        expect(nativeBottomFollowCanApplyCompletion({
            canCompletePendingPin: true,
            distanceFromBottom: 18,
            isNative: true,
            pinThresholdPx: 10,
            wantsPinned: true,
        })).toBe(false);

        expect(nativeBottomFollowCanApplyCompletion({
            canCompletePendingPin: true,
            distanceFromBottom: 8,
            isNative: false,
            pinThresholdPx: 10,
            wantsPinned: true,
        })).toBe(false);
    });
});
