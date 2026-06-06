import { describe, expect, it } from 'vitest';

import {
    resolveNativePassiveBottomDriftNoiseFloorPx,
    shouldIgnoreNativePassiveViewportScroll,
    shouldIgnoreNativeRecycledTopJump,
    shouldRecordNativePassiveUnpinnedMovement,
} from './nativePassiveScrollPolicy';

describe('native passive scroll policy', () => {
    it('caps passive bottom-drift noise by the pinned threshold', () => {
        expect(resolveNativePassiveBottomDriftNoiseFloorPx({
            configuredBottomDistanceNoiseFloorPx: 24,
            pinThresholdPx: 12,
        })).toBe(12);
        expect(resolveNativePassiveBottomDriftNoiseFloorPx({
            configuredBottomDistanceNoiseFloorPx: 6,
            pinThresholdPx: 12,
        })).toBe(6);
        expect(resolveNativePassiveBottomDriftNoiseFloorPx({
            configuredBottomDistanceNoiseFloorPx: Number.NaN,
            pinThresholdPx: 12,
        })).toBe(0);
    });

    it('detects recycled native top jumps only for large unpinned passive jumps', () => {
        expect(shouldIgnoreNativeRecycledTopJump({
            distanceFromBottom: 900,
            hasNativeInitialViewportApplied: true,
            isWeb: false,
            pinThresholdPx: 20,
            previousDistanceFromBottom: 100,
            requireNativeInitialViewportApplied: false,
            thresholdMultiplier: 8,
            viewportHeight: 100,
            viewportMultiplier: 4,
            wantsPinned: false,
        })).toBe(true);

        expect(shouldIgnoreNativeRecycledTopJump({
            distanceFromBottom: 160,
            hasNativeInitialViewportApplied: true,
            isWeb: false,
            pinThresholdPx: 20,
            previousDistanceFromBottom: 100,
            requireNativeInitialViewportApplied: false,
            thresholdMultiplier: 8,
            viewportHeight: 100,
            viewportMultiplier: 4,
            wantsPinned: false,
        })).toBe(false);

        expect(shouldIgnoreNativeRecycledTopJump({
            distanceFromBottom: 900,
            hasNativeInitialViewportApplied: true,
            isWeb: false,
            pinThresholdPx: 20,
            previousDistanceFromBottom: 100,
            requireNativeInitialViewportApplied: false,
            thresholdMultiplier: 8,
            viewportHeight: 100,
            viewportMultiplier: 4,
            wantsPinned: true,
        })).toBe(false);
    });

    it('can require the native initial viewport to be applied before filtering recycled top jumps', () => {
        expect(shouldIgnoreNativeRecycledTopJump({
            distanceFromBottom: 900,
            hasNativeInitialViewportApplied: false,
            isWeb: false,
            pinThresholdPx: 20,
            previousDistanceFromBottom: 100,
            requireNativeInitialViewportApplied: true,
            thresholdMultiplier: 8,
            viewportHeight: 100,
            viewportMultiplier: 4,
            wantsPinned: false,
        })).toBe(false);
    });

    it('records passive unpinned movement only after native content and viewport ownership are established', () => {
        const base = {
            configuredBottomDistanceNoiseFloorPx: 4,
            distanceFromBottom: 40,
            isWeb: false,
            pinThresholdPx: 16,
            wantsPinned: false,
        };

        expect(shouldRecordNativePassiveUnpinnedMovement({
            ...base,
            hasNativeContentMeasurement: true,
            hasNativeInitialViewportApplied: true,
        })).toBe(true);
        expect(shouldRecordNativePassiveUnpinnedMovement({
            ...base,
            hasNativeContentMeasurement: false,
            hasNativeInitialViewportApplied: true,
        })).toBe(false);
        expect(shouldRecordNativePassiveUnpinnedMovement({
            ...base,
            hasNativeContentMeasurement: true,
            hasNativeInitialViewportApplied: false,
        })).toBe(false);
        expect(shouldRecordNativePassiveUnpinnedMovement({
            ...base,
            distanceFromBottom: 4,
            hasNativeContentMeasurement: true,
            hasNativeInitialViewportApplied: true,
        })).toBe(false);
    });

    it('ignores passive native viewport scrolls that are unmeasured, near noise, or from an unrestored entry viewport', () => {
        expect(shouldIgnoreNativePassiveViewportScroll({
            configuredBottomDistanceNoiseFloorPx: 4,
            currentSessionId: 'session-a',
            distanceFromBottom: 40,
            entryViewportSessionId: null,
            entryViewportShouldFollowBottom: null,
            hasNativeContentMeasurement: false,
            hasNativeInitialViewportApplied: true,
            isTrusted: false,
            isWeb: false,
            nowMs: 1000,
            lastUserScrollIntentAtMs: Number.NEGATIVE_INFINITY,
            pinThresholdPx: 16,
            shouldIgnoreRecycledTopJump: false,
            shouldRecordPassiveUnpinnedMovement: false,
            userIntentRecentMs: 500,
            wantsPinned: false,
        })).toBe(true);

        expect(shouldIgnoreNativePassiveViewportScroll({
            configuredBottomDistanceNoiseFloorPx: 4,
            currentSessionId: 'session-a',
            distanceFromBottom: 4,
            entryViewportSessionId: null,
            entryViewportShouldFollowBottom: null,
            hasNativeContentMeasurement: true,
            hasNativeInitialViewportApplied: true,
            isTrusted: false,
            isWeb: false,
            nowMs: 1000,
            lastUserScrollIntentAtMs: Number.NEGATIVE_INFINITY,
            pinThresholdPx: 16,
            shouldIgnoreRecycledTopJump: false,
            shouldRecordPassiveUnpinnedMovement: false,
            userIntentRecentMs: 500,
            wantsPinned: false,
        })).toBe(true);

        expect(shouldIgnoreNativePassiveViewportScroll({
            configuredBottomDistanceNoiseFloorPx: 4,
            currentSessionId: 'session-a',
            distanceFromBottom: 40,
            entryViewportSessionId: 'session-a',
            entryViewportShouldFollowBottom: false,
            hasNativeContentMeasurement: true,
            hasNativeInitialViewportApplied: false,
            isTrusted: false,
            isWeb: false,
            nowMs: 1000,
            lastUserScrollIntentAtMs: Number.NEGATIVE_INFINITY,
            pinThresholdPx: 16,
            shouldIgnoreRecycledTopJump: false,
            shouldRecordPassiveUnpinnedMovement: false,
            userIntentRecentMs: 500,
            wantsPinned: false,
        })).toBe(true);
    });

    it('keeps trusted and recent-user-intent scrolls observable', () => {
        const base = {
            configuredBottomDistanceNoiseFloorPx: 4,
            currentSessionId: 'session-a',
            distanceFromBottom: 40,
            entryViewportSessionId: null,
            entryViewportShouldFollowBottom: null,
            hasNativeContentMeasurement: true,
            hasNativeInitialViewportApplied: true,
            isWeb: false,
            nowMs: 1000,
            pinThresholdPx: 16,
            shouldIgnoreRecycledTopJump: false,
            shouldRecordPassiveUnpinnedMovement: false,
            userIntentRecentMs: 500,
            wantsPinned: false,
        };

        expect(shouldIgnoreNativePassiveViewportScroll({
            ...base,
            isTrusted: true,
            lastUserScrollIntentAtMs: Number.NEGATIVE_INFINITY,
        })).toBe(false);
        expect(shouldIgnoreNativePassiveViewportScroll({
            ...base,
            isTrusted: false,
            lastUserScrollIntentAtMs: 700,
        })).toBe(false);
    });
});
