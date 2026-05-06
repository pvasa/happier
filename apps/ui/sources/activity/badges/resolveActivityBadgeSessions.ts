import type { SessionListRenderableSession } from '@/sync/domains/session/listing/sessionListRenderable';
import type { Session } from '@/sync/domains/state/storageTypes';

export type ActivityBadgeSourceSession = Session | SessionListRenderableSession;

export function resolveActivityBadgeSessions(params: Readonly<{
    sessions: readonly Session[];
    sessionRows: readonly SessionListRenderableSession[];
}>): ActivityBadgeSourceSession[] {
    if (params.sessionRows.length === 0) {
        return [...params.sessions];
    }

    const sessionsById = new Map(params.sessions.map((session) => [session.id, session]));
    const seenSessionIds = new Set<string>();
    const resolvedSessions: ActivityBadgeSourceSession[] = [];

    for (const row of params.sessionRows) {
        if (seenSessionIds.has(row.id)) continue;
        seenSessionIds.add(row.id);
        resolvedSessions.push(sessionsById.get(row.id) ?? row);
    }

    for (const session of params.sessions) {
        if (seenSessionIds.has(session.id)) continue;
        seenSessionIds.add(session.id);
        resolvedSessions.push(session);
    }

    return resolvedSessions;
}
