export type SessionSnapshotRefreshReason =
    | 'initial-unknown'
    | 'socket-connect-catchup'
    | 'socket-reconnect-catchup'
    | 'metadata-version-unknown'
    | 'pending-version-unknown'
    | 'explicit-drain'
    | 'startup-drain'
    | 'manual-recovery'
    | 'prompt-dispatch-boundary'
    | 'override-flush-readback'
    | 'degraded-socket'
    | 'legacy-compat-proof';

export type LegacySessionSnapshotRefreshReason = 'connect' | 'waitForMetadataUpdate';

export type SessionSnapshotRefreshReasonInput =
    | SessionSnapshotRefreshReason
    | LegacySessionSnapshotRefreshReason;

export function normalizeSessionSnapshotRefreshReason(
    reason: SessionSnapshotRefreshReasonInput,
): SessionSnapshotRefreshReason {
    switch (reason) {
        case 'connect':
            return 'socket-connect-catchup';
        case 'waitForMetadataUpdate':
            return 'metadata-version-unknown';
        default:
            return reason;
    }
}

export function buildSessionDetailRequestPurpose(
    reason: SessionSnapshotRefreshReasonInput,
): string {
    return `session-detail:${normalizeSessionSnapshotRefreshReason(reason)}`;
}
