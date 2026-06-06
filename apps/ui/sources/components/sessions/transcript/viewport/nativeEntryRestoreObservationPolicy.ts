export type NativeEntryRestoreObservationTarget = Readonly<{
    contentHeight?: number;
    kind: 'anchor' | 'distance';
    offsetY: number;
    sessionId: string;
    targetOffsetY?: number;
    targetOffsetYWasClamped?: boolean;
}>;

export function nativeEntryRestoreObservationMatches(
    target: NativeEntryRestoreObservationTarget | null | undefined,
    params: Readonly<{
        contentHeight: number;
        distanceFromBottom: number;
        observedOffsetY: number;
        sessionId: string;
        tolerancePx: number;
    }>,
): boolean {
    if (!target || target.sessionId !== params.sessionId) return false;
    if (Math.abs(params.distanceFromBottom - target.offsetY) <= params.tolerancePx) {
        return true;
    }
    return nativeEntryRestoreTargetOffsetMatches(target, params);
}

export function nativeEntryRestoreObservationExceedsJumpThreshold(
    target: NativeEntryRestoreObservationTarget | null | undefined,
    params: Readonly<{
        distanceFromBottom: number;
        jumpThresholdPx: number;
        sessionId: string;
    }>,
): boolean {
    return (
        target?.sessionId === params.sessionId &&
        params.jumpThresholdPx > 0 &&
        params.distanceFromBottom > target.offsetY + params.jumpThresholdPx
    );
}

export function resolveNativeEntryRestoreJumpThresholdPx(params: Readonly<{
    layoutHeight: number;
    pinThresholdPx: number;
    thresholdMultiplier: number;
    viewportMultiplier: number;
}>): number {
    return Math.max(
        params.layoutHeight > 0 ? params.layoutHeight * params.viewportMultiplier : 0,
        params.pinThresholdPx * params.thresholdMultiplier,
    );
}

function nativeEntryRestoreTargetOffsetMatches(
    target: NativeEntryRestoreObservationTarget,
    params: Readonly<{
        contentHeight: number;
        observedOffsetY: number;
        tolerancePx: number;
    }>,
): boolean {
    return (
        target.kind === 'distance' &&
        target.targetOffsetYWasClamped !== true &&
        targetContentReady(target, params) &&
        Number.isFinite(target.targetOffsetY) &&
        Math.abs(params.observedOffsetY - (target.targetOffsetY ?? 0)) <= params.tolerancePx
    );
}

function targetContentReady(
    target: NativeEntryRestoreObservationTarget,
    params: Readonly<{
        contentHeight: number;
        tolerancePx: number;
    }>,
): boolean {
    return target.contentHeight == null || params.contentHeight + params.tolerancePx >= target.contentHeight;
}
