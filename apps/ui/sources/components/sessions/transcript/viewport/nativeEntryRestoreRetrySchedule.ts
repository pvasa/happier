export type NativeEntryRestoreRetryScheduleSnapshot = Readonly<{
    dueAtMs: number;
    offsetY: number;
    sessionId: string;
}>;

export type NativeEntryRestoreRetryScheduleRequest = Readonly<{
    lastRetryAtMs: number;
    minIntervalMs: number;
    nowMs: number;
    offsetY: number;
    retryAttempt: number;
    retryLimit: number;
    sessionId: string;
}>;

export type NativeEntryRestoreRetryScheduleDecision =
    | Readonly<{
        action: 'keep-existing';
        dueAtMs: number;
    }>
    | Readonly<{
        action: 'replace';
        dueAtMs: number;
    }>
    | Readonly<{
        action: 'skip';
        reason: 'retry-limit';
    }>;

export function resolveNativeEntryRestoreRetrySchedule(
    current: NativeEntryRestoreRetryScheduleSnapshot | null,
    request: NativeEntryRestoreRetryScheduleRequest,
): NativeEntryRestoreRetryScheduleDecision {
    if (request.retryAttempt >= request.retryLimit) {
        return {
            action: 'skip',
            reason: 'retry-limit',
        };
    }
    if (
        current &&
        current.sessionId === request.sessionId &&
        current.offsetY === request.offsetY
    ) {
        return {
            action: 'keep-existing',
            dueAtMs: current.dueAtMs,
        };
    }

    const elapsedSinceLastRetryMs = request.nowMs - request.lastRetryAtMs;
    const delayMs = Math.max(0, normalizeMs(request.minIntervalMs) - elapsedSinceLastRetryMs + 1);
    return {
        action: 'replace',
        dueAtMs: request.nowMs + delayMs,
    };
}

function normalizeMs(value: number): number {
    return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}
