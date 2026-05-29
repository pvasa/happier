import type {
    SessionListRowStateSnapshot,
    SessionListRowStoreState,
} from '@/components/sessions/shell/row/sessionListRowModelTypes';
import { syncPerformanceTelemetry } from '@/sync/runtime/syncPerformanceTelemetry';

type SessionListRowStateSnapshotScope = Readonly<{
    sessionId: string;
    serverId?: string | null;
}>;

type SessionListRowStoreStateSelectorInput = Readonly<{
    sessions?: SessionListRowStoreState['sessions'];
    sessionListRenderables?: SessionListRowStoreState['sessionListRenderables'];
    sessionMessages?: SessionListRowStoreState['sessionMessages'];
    sessionPending?: SessionListRowStoreState['sessionPending'];
}>;

type MutableSessionListRowStoreState = {
    activeServerId?: string | null;
    sessions: Record<string, ReturnType<typeof selectSessionListRowStateSnapshot>['session']>;
    sessionListRenderables: Record<string, ReturnType<typeof selectSessionListRowStateSnapshot>['renderable']>;
    sessionMessages: Record<string, ReturnType<typeof selectSessionListRowStateSnapshot>['messages']>;
    sessionPending: Record<string, ReturnType<typeof selectSessionListRowStateSnapshot>['pending']>;
};

function normalizeId(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

function normalizeScope(scope: string | SessionListRowStateSnapshotScope): SessionListRowStateSnapshotScope {
    if (typeof scope === 'string') {
        return { sessionId: scope };
    }
    return scope;
}

function shouldReadActiveServerOverlay(
    state: SessionListRowStoreState,
    rowServerId: string | null | undefined,
): boolean {
    const activeServerId = normalizeId(state.activeServerId);
    const normalizedRowServerId = normalizeId(rowServerId);
    if (!activeServerId || !normalizedRowServerId) return true;
    return activeServerId === normalizedRowServerId;
}

export function selectSessionListRowStateSnapshot(
    state: SessionListRowStoreState,
    scope: string | SessionListRowStateSnapshotScope,
): SessionListRowStateSnapshot {
    const normalizedScope = normalizeScope(scope);
    const sessionId = normalizedScope.sessionId;
    if (!shouldReadActiveServerOverlay(state, normalizedScope.serverId)) {
        return {
            session: undefined,
            renderable: undefined,
            messages: undefined,
            pending: undefined,
        };
    }

    return {
        session: state.sessions?.[sessionId],
        renderable: state.sessionListRenderables?.[sessionId],
        messages: state.sessionMessages?.[sessionId],
        pending: state.sessionPending?.[sessionId],
    };
}

function countChangedRefs(previous: readonly unknown[] | null, next: readonly unknown[]): number {
    if (previous === null) return next.length;
    const maxLength = Math.max(previous.length, next.length);
    let changed = 0;
    for (let index = 0; index < maxLength; index += 1) {
        if (previous[index] !== next[index]) changed += 1;
    }
    return changed;
}

function recordRowStoreSelectorChangeTelemetry(fields: Readonly<Record<string, number>>): void {
    if (!syncPerformanceTelemetry.isEnabled()) return;
    syncPerformanceTelemetry.count('ui.sessionsList.rowStoreSelector.changed', fields);
}

export function createSessionListRowStoreStateSelector(
    scopes: readonly SessionListRowStateSnapshotScope[],
    activeServerId: string | null | undefined,
): (state: SessionListRowStoreStateSelectorInput) => SessionListRowStoreState {
    const normalizedScopes = scopes.map(normalizeScope);
    let previousSessions: readonly unknown[] | null = null;
    let previousRenderables: readonly unknown[] | null = null;
    let previousMessages: readonly unknown[] | null = null;
    let previousPending: readonly unknown[] | null = null;
    let previousOutput: SessionListRowStoreState | null = null;

    return (state) => {
        const nextSessions: unknown[] = [];
        const nextRenderables: unknown[] = [];
        const nextMessages: unknown[] = [];
        const nextPending: unknown[] = [];
        const sessions: MutableSessionListRowStoreState['sessions'] = {};
        const sessionListRenderables: MutableSessionListRowStoreState['sessionListRenderables'] = {};
        const sessionMessages: MutableSessionListRowStoreState['sessionMessages'] = {};
        const sessionPending: MutableSessionListRowStoreState['sessionPending'] = {};

        for (const scope of normalizedScopes) {
            const sessionId = scope.sessionId;
            const renderable = state.sessionListRenderables?.[sessionId];
            const session = renderable ? undefined : state.sessions?.[sessionId];
            const messages = renderable ? undefined : state.sessionMessages?.[sessionId];
            const pending = state.sessionPending?.[sessionId];
            nextSessions.push(session);
            nextRenderables.push(renderable);
            nextMessages.push(messages);
            nextPending.push(pending);
            sessions[sessionId] = session;
            sessionListRenderables[sessionId] = renderable;
            sessionMessages[sessionId] = messages;
            sessionPending[sessionId] = pending;
        }

        if (
            previousOutput !== null
            && refsEqual(previousSessions, nextSessions)
            && refsEqual(previousRenderables, nextRenderables)
            && refsEqual(previousMessages, nextMessages)
            && refsEqual(previousPending, nextPending)
        ) {
            return previousOutput;
        }

        recordRowStoreSelectorChangeTelemetry({
            scopedRows: normalizedScopes.length,
            initialOutput: previousOutput === null ? 1 : 0,
            changedSessions: countChangedRefs(previousSessions, nextSessions),
            changedRenderables: countChangedRefs(previousRenderables, nextRenderables),
            changedMessages: countChangedRefs(previousMessages, nextMessages),
            changedPending: countChangedRefs(previousPending, nextPending),
        });

        previousSessions = nextSessions;
        previousRenderables = nextRenderables;
        previousMessages = nextMessages;
        previousPending = nextPending;
        previousOutput = {
            activeServerId,
            sessions,
            sessionListRenderables,
            sessionMessages,
            sessionPending,
        };
        return previousOutput;
    };
}

function refsEqual(previous: readonly unknown[] | null, next: readonly unknown[]): boolean {
    if (previous === null) return false;
    if (previous.length !== next.length) return false;
    for (let index = 0; index < previous.length; index += 1) {
        if (previous[index] !== next[index]) return false;
    }
    return true;
}
