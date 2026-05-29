import { syncPerformanceTelemetry } from '@/sync/runtime/syncPerformanceTelemetry';

export type SessionInvalidationTelemetryReason =
    | 'socketNewSession'
    | 'socketPendingChangedMissingSession'
    | 'socketUpdateSessionMissingUnpatchable'
    | 'socketSharingChanged';

const REASON_FIELD_BY_REASON: Readonly<Record<SessionInvalidationTelemetryReason, string>> = {
    socketNewSession: 'reason_socketNewSession',
    socketPendingChangedMissingSession: 'reason_socketPendingChangedMissingSession',
    socketUpdateSessionMissingUnpatchable: 'reason_socketUpdateSessionMissingUnpatchable',
    socketSharingChanged: 'reason_socketSharingChanged',
};

export function recordSessionInvalidationRequested(
    reason: SessionInvalidationTelemetryReason,
    fields: Readonly<Record<string, number>> = {},
): void {
    if (!syncPerformanceTelemetry.isEnabled()) return;
    syncPerformanceTelemetry.count('sync.sessions.invalidate.requested', {
        ...fields,
        [REASON_FIELD_BY_REASON[reason]]: 1,
    });
}
