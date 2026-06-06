export type NativeMountSettleRetryScheduleSnapshot = Readonly<{
    dueAtMs: number;
    sessionId: string;
}>;

export type NativeMountSettleRetryScheduleRequest = Readonly<{
    delayMs: number;
    nowMs: number;
    sessionId: string;
}>;

export type NativeMountSettleRetryScheduleDecision =
    | Readonly<{
        action: 'keep-existing';
        dueAtMs: number;
    }>
    | Readonly<{
        action: 'replace';
        dueAtMs: number;
    }>;

export function resolveNativeMountSettleRetrySchedule(
    current: NativeMountSettleRetryScheduleSnapshot | null,
    request: NativeMountSettleRetryScheduleRequest,
): NativeMountSettleRetryScheduleDecision {
    const normalizedDelayMs = normalizeDelayMs(request.delayMs);
    const requestedDueAtMs = request.nowMs + normalizedDelayMs;
    if (
        current &&
        current.sessionId === request.sessionId &&
        current.dueAtMs <= requestedDueAtMs
    ) {
        return {
            action: 'keep-existing',
            dueAtMs: current.dueAtMs,
        };
    }
    return {
        action: 'replace',
        dueAtMs: requestedDueAtMs,
    };
}

function normalizeDelayMs(value: number): number {
    return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}
