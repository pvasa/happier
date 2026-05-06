import type { Session } from '@/sync/domains/state/storageTypes';
import { deriveSessionReadState } from '@/sync/domains/session/readState/sessionReadState';
import { listPendingPermissionRequests, listPendingUserActionRequests, type PendingPermissionRequest } from '@/utils/sessions/sessionUtils';
import type { SessionListRenderableSession } from '@/sync/domains/session/listing/sessionListRenderable';
import { isUserFacingSession } from '@/sync/domains/session/listing/isUserFacingSession';

export type InboxSessionAttentionEntry = Readonly<{
    session: Session;
    pendingPermissions: readonly PendingPermissionRequest[];
    pendingUserActions: readonly PendingPermissionRequest[];
}>;

export type InboxUnreadSession = Session | SessionListRenderableSession;

export type InboxSessionState = Readonly<{
    unreadSessions: InboxUnreadSession[];
    sessionsNeedingAttention: InboxSessionAttentionEntry[];
}>;

type BuildInboxSessionStateInput =
    | readonly Session[]
    | Readonly<{
        sessions: readonly Session[];
        sessionRows?: readonly InboxUnreadSession[];
    }>;

function normalizeBuildInboxSessionStateInput(input: BuildInboxSessionStateInput): Readonly<{
    sessions: readonly Session[];
    sessionRows: readonly InboxUnreadSession[];
}> {
    if ('sessions' in input) {
        return {
            sessions: input.sessions,
            sessionRows: input.sessionRows && input.sessionRows.length > 0 ? input.sessionRows : input.sessions,
        };
    }
    return { sessions: input, sessionRows: input };
}

function hasUnreadSessionAttention(session: InboxUnreadSession): boolean {
    if ('metadataUnavailable' in session && session.metadataUnavailable === true) {
        return false;
    }
    if ('hasUnreadMessages' in session && typeof session.hasUnreadMessages === 'boolean') {
        return session.hasUnreadMessages;
    }
    return deriveSessionReadState(session) === 'unread';
}

export function buildInboxSessionState(input: BuildInboxSessionStateInput): InboxSessionState {
    const { sessions, sessionRows } = normalizeBuildInboxSessionStateInput(input);
    const sessionsById = new Map(sessions.map((session) => [session.id, session]));
    const sessionsNeedingAttention: InboxSessionAttentionEntry[] = [];
    const attentionSessionIds = new Set<string>();

    for (const session of sessions) {
        if (!isUserFacingSession(session)) continue;
        const pendingPermissions = listPendingPermissionRequests(session);
        const pendingUserActions = listPendingUserActionRequests(session);
        if (pendingPermissions.length === 0 && pendingUserActions.length === 0) continue;

        attentionSessionIds.add(session.id);
        sessionsNeedingAttention.push({
            session,
            pendingPermissions,
            pendingUserActions,
        });
    }

    const unreadCandidates: InboxUnreadSession[] = [];
    const candidateSessionIds = new Set<string>();
    for (const row of sessionRows) {
        if (candidateSessionIds.has(row.id)) continue;
        candidateSessionIds.add(row.id);
        unreadCandidates.push(sessionsById.get(row.id) ?? row);
    }
    for (const session of sessions) {
        if (candidateSessionIds.has(session.id)) continue;
        candidateSessionIds.add(session.id);
        unreadCandidates.push(session);
    }

    const unreadSessions: InboxUnreadSession[] = [];
    const unreadSessionIds = new Set<string>();
    for (const session of unreadCandidates) {
        if (!isUserFacingSession(session)) continue;
        if (attentionSessionIds.has(session.id)) continue;
        if (unreadSessionIds.has(session.id)) continue;
        if (!hasUnreadSessionAttention(session)) continue;
        unreadSessionIds.add(session.id);
        unreadSessions.push(session);
    }

    return {
        unreadSessions,
        sessionsNeedingAttention,
    };
}
