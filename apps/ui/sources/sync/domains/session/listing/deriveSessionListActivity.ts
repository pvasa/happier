import type { SessionState } from '@/utils/sessions/sessionUtils';
import { deriveSessionAttentionState } from '../attention/deriveSessionAttentionState';
import type { PrimaryTurnStatusV1, SessionRuntimeIssueV1 } from '@happier-dev/protocol';

export type SessionListSecondaryLineMode = 'status' | 'path';
export type SessionListAttentionState =
    | 'quiet'
    | 'unread'
    | 'pending'
    | 'ready'
    | 'failed'
    | 'thinking'
    | 'permission_required'
    | 'action_required';

export function deriveSessionListMeaningfulActivityAt(params: Readonly<{
    sessionCreatedAt: number | null | undefined;
    latestCommittedMessageCreatedAt: number | null | undefined;
    latestThinkingActivityAt: number | null | undefined;
    latestPendingMessageCreatedAt: number | null | undefined;
}>): number | null {
    const meaningfulCandidates = [
        params.latestCommittedMessageCreatedAt,
        params.latestPendingMessageCreatedAt,
        params.sessionCreatedAt,
    ];

    let latest: number | null = null;
    for (const candidate of meaningfulCandidates) {
        if (typeof candidate !== 'number' || !Number.isFinite(candidate) || candidate <= 0) continue;
        latest = latest == null ? candidate : Math.max(latest, candidate);
    }

    return latest;
}

export function deriveSessionListAttentionState(input: Readonly<{
    hasUnreadMessages: boolean;
    pendingCount: number;
    sessionState: SessionState;
    latestTurnStatus?: PrimaryTurnStatusV1 | null;
    lastRuntimeIssue?: SessionRuntimeIssueV1 | null;
    latestReadyEventSeq?: number | null;
    latestReadyEventAt?: number | null;
    lastViewedSessionSeq?: number | null;
}>): SessionListAttentionState {
    const sessionAttention = deriveSessionAttentionState({
        latestTurnStatus: input.latestTurnStatus,
        lastRuntimeIssue: input.lastRuntimeIssue,
    });
    if (sessionAttention === 'failed') return 'failed';
    if (input.sessionState === 'action_required') return 'action_required';
    if (input.sessionState === 'permission_required') return 'permission_required';
    // Legacy list/session internals call active turn work "thinking"; row presentation maps this to product "working".
    if (sessionAttention === 'running') return 'thinking';
    if (input.sessionState === 'resuming') return 'thinking';
    if (input.sessionState === 'thinking') return 'thinking';
    if (isReadyEventAfterReadCursor(input)) return 'ready';
    if (input.pendingCount > 0) return 'pending';
    if (input.hasUnreadMessages) return 'unread';
    return 'quiet';
}

function isReadyEventAfterReadCursor(input: Readonly<{
    latestReadyEventSeq?: number | null;
    lastViewedSessionSeq?: number | null;
}>): boolean {
    const latestReadyEventSeq = normalizeSeq(input.latestReadyEventSeq);
    if (latestReadyEventSeq === null) return false;
    return latestReadyEventSeq > (normalizeSeq(input.lastViewedSessionSeq) ?? 0);
}

function normalizeSeq(value: number | null | undefined): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    return Math.max(0, Math.trunc(value));
}

export function resolveSessionListSecondaryLineMode(params: Readonly<{
    groupKind?: 'active' | 'date' | 'project' | 'pinned' | 'shared' | 'folder' | null;
}>): SessionListSecondaryLineMode {
    if (params.groupKind === 'date') {
        return 'path';
    }
    return 'status';
}
