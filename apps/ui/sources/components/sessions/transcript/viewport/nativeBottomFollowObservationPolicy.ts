export type NativeBottomFollowStaleObservationCandidate = Readonly<{
    distanceFromBottom: number;
    observedAtMs: number;
    offsetY: number;
    sessionId: string;
}>;

export type NativeBottomFollowContentChangeCandidate = Readonly<{
    deltaHeightPx: number;
    measuredAtMs: number;
    sessionId: string;
}>;

function isFiniteNumber(value: number | null | undefined): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

export function filterRecentNativeBottomFollowStaleObservationCandidates(
    candidates: readonly NativeBottomFollowStaleObservationCandidate[],
    params: Readonly<{
        nowMs: number;
        recentWindowMs: number;
        sessionId: string;
    }>,
): NativeBottomFollowStaleObservationCandidate[] {
    return candidates.filter(
        (candidate) =>
            candidate.sessionId === params.sessionId &&
            params.nowMs - candidate.observedAtMs <= params.recentWindowMs,
    );
}

export function appendNativeBottomFollowStaleObservationCandidate(
    candidates: readonly NativeBottomFollowStaleObservationCandidate[],
    candidate: NativeBottomFollowStaleObservationCandidate,
    params: Readonly<{
        maxCandidates: number;
    }>,
): NativeBottomFollowStaleObservationCandidate[] {
    return [...candidates, candidate].slice(-params.maxCandidates);
}

export function filterRecentNativeBottomFollowContentChangeCandidates(
    candidates: readonly NativeBottomFollowContentChangeCandidate[],
    params: Readonly<{
        nowMs: number;
        recentWindowMs: number;
        sessionId: string;
    }>,
): NativeBottomFollowContentChangeCandidate[] {
    return candidates.filter(
        (candidate) =>
            candidate.sessionId === params.sessionId &&
            params.nowMs - candidate.measuredAtMs <= params.recentWindowMs,
    );
}

export function appendNativeBottomFollowContentChangeCandidate(
    candidates: readonly NativeBottomFollowContentChangeCandidate[],
    candidate: NativeBottomFollowContentChangeCandidate,
    params: Readonly<{
        maxCandidates: number;
    }>,
): NativeBottomFollowContentChangeCandidate[] {
    return [...candidates, candidate].slice(-params.maxCandidates);
}

export function nativeBottomFollowStaleObservationMatches(
    candidate: NativeBottomFollowStaleObservationCandidate,
    params: Readonly<{
        distanceFromBottom: number;
        offsetY: number;
        pinThresholdPx: number;
        sessionId: string;
    }>,
): boolean {
    return (
        candidate.sessionId === params.sessionId &&
        (
            Math.abs(candidate.distanceFromBottom - params.distanceFromBottom) <= params.pinThresholdPx ||
            Math.abs(candidate.offsetY - params.offsetY) <= params.pinThresholdPx
        )
    );
}

export function nativeBottomFollowContentChangeObservationMatches(
    candidate: NativeBottomFollowContentChangeCandidate,
    params: Readonly<{
        distanceFromBottom: number;
        pinThresholdPx: number;
        sessionId: string;
    }>,
): boolean {
    const tolerancePx = Math.max(params.pinThresholdPx, 2);
    return (
        candidate.sessionId === params.sessionId &&
        Math.abs(candidate.deltaHeightPx - params.distanceFromBottom) <= tolerancePx
    );
}

export function nativeBottomFollowPinTargetObserved(params: Readonly<{
    lastNativePinOffset: number | null | undefined;
    pinThresholdPx: number;
    visualBottomScrollOffset: number | null | undefined;
}>): boolean {
    if (!isFiniteNumber(params.lastNativePinOffset) || !isFiniteNumber(params.visualBottomScrollOffset)) {
        return false;
    }
    return (
        Math.abs(params.visualBottomScrollOffset - params.lastNativePinOffset) <= params.pinThresholdPx ||
        params.lastNativePinOffset >= params.visualBottomScrollOffset - params.pinThresholdPx
    );
}

export function nativeBottomFollowCanCompletePendingPin(params: Readonly<{
    mountSettleDeadlineReached: boolean;
    mountSettleStable: boolean;
    pendingBottomPin: boolean;
    pinTargetObserved: boolean;
}>): boolean {
    return (
        params.mountSettleStable ||
        params.mountSettleDeadlineReached ||
        !params.pendingBottomPin ||
        params.pinTargetObserved
    );
}

export function nativeBottomFollowShouldRecordTargetConfirmation(params: Readonly<{
    hasStaleObservationCandidate: boolean;
    isTrusted: boolean;
    pinTargetObserved: boolean;
    usesNativeBottomMaintenance: boolean;
    wantsPinned: boolean;
}>): boolean {
    return (
        params.pinTargetObserved ||
        (
            params.usesNativeBottomMaintenance &&
            params.wantsPinned &&
            !params.isTrusted &&
            params.hasStaleObservationCandidate
        )
    );
}

export function nativeBottomFollowCanApplyCompletion(params: Readonly<{
    canCompletePendingPin: boolean;
    distanceFromBottom: number;
    isNative: boolean;
    pinThresholdPx: number;
    wantsPinned: boolean;
}>): boolean {
    return (
        params.isNative &&
        params.wantsPinned &&
        params.distanceFromBottom <= params.pinThresholdPx &&
        params.canCompletePendingPin
    );
}
