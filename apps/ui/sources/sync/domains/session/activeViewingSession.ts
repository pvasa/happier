/**
 * Module-scoped tracker for the session the user is currently viewing.
 *
 * The notification handler (`Notifications.setNotificationHandler`) runs outside
 * the React component tree so it cannot use hooks. This singleton provides a
 * synchronous way to check which session is on-screen, enabling same-session
 * notification suppression.
 */

import { normalizeSessionListKeyParts } from './listing/sessionListKeyNormalization';
import { resolveServerIdForSessionIdFromLocalCache } from '@/sync/runtime/orchestration/serverScopedRpc/resolveServerIdForSessionIdFromLocalCache';

type ActiveViewingSessionEntry = Readonly<{
    sessionId: string;
    activationId: number | null;
    serverId: string | null;
}>;

let activeViewingSessionEntries: ActiveViewingSessionEntry[] = [];
const visibleSessionRefCounts = new Map<string, number>();
const visibleSessionScopedRefCounts = new Map<string, number>();
const visibleScopedSessionKeysBySessionId = new Map<string, Set<string>>();

function normalizeText(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

function normalizeSessionId(value: unknown): string {
    return normalizeText(value);
}

function normalizeServerId(value: unknown): string {
    return normalizeText(value);
}

function resolveVisibleSessionIdentity(sessionIdRaw: unknown, serverIdRaw?: unknown): Readonly<{
    sessionId: string;
    serverId: string | null;
    sessionKey: string | null;
}> {
    const sessionId = normalizeSessionId(sessionIdRaw);
    const explicitServerId = normalizeServerId(serverIdRaw);
    if (!sessionId) {
        return { sessionId: '', serverId: null, sessionKey: null };
    }

    const serverId = explicitServerId || resolveServerIdForSessionIdFromLocalCache(sessionId) || '';
    const sessionKey = normalizeSessionListKeyParts(serverId, sessionId).sessionKey;
    return {
        sessionId,
        serverId: serverId || null,
        sessionKey,
    };
}

function addVisibleScopedSessionKey(sessionId: string, sessionKey: string): void {
    const current = visibleScopedSessionKeysBySessionId.get(sessionId) ?? new Set<string>();
    current.add(sessionKey);
    visibleScopedSessionKeysBySessionId.set(sessionId, current);
}

function removeVisibleScopedSessionKey(sessionId: string, sessionKey: string): void {
    const current = visibleScopedSessionKeysBySessionId.get(sessionId);
    if (!current) return;
    current.delete(sessionKey);
    if (current.size === 0) {
        visibleScopedSessionKeysBySessionId.delete(sessionId);
        return;
    }
    visibleScopedSessionKeysBySessionId.set(sessionId, current);
}

function getCurrentActiveViewingSessionEntry(): ActiveViewingSessionEntry | null {
    return activeViewingSessionEntries[activeViewingSessionEntries.length - 1] ?? null;
}

function removeActiveViewingSessionEntryAt(index: number): void {
    activeViewingSessionEntries = [
        ...activeViewingSessionEntries.slice(0, index),
        ...activeViewingSessionEntries.slice(index + 1),
    ];
}

export const getActiveViewingSessionId = (): string | null => getCurrentActiveViewingSessionEntry()?.sessionId ?? null;
export const getActiveViewingSessionActivationId = (): number | null => getCurrentActiveViewingSessionEntry()?.activationId ?? null;

export const setActiveViewingSessionId = (
    sessionId: string,
    activationId: number | null = null,
    serverId?: string | null,
): void => {
    const identity = resolveVisibleSessionIdentity(sessionId, serverId);
    if (!identity.sessionId) return;
    activeViewingSessionEntries = [
        ...activeViewingSessionEntries,
        { sessionId: identity.sessionId, activationId, serverId: identity.serverId },
    ];
};

export const clearActiveViewingSessionId = (
    sessionId: string,
    activationId?: number | null,
    serverId?: string | null,
): void => {
    const identity = resolveVisibleSessionIdentity(sessionId, serverId);
    if (!identity.sessionId) return;

    if (activationId !== undefined) {
        const index = activeViewingSessionEntries.findIndex(
            (entry) => (
                entry.sessionId === identity.sessionId
                && entry.activationId === activationId
                && (
                    identity.serverId == null
                    || entry.serverId == null
                    || entry.serverId === identity.serverId
                )
            ),
        );
        if (index >= 0) {
            removeActiveViewingSessionEntryAt(index);
        }
        return;
    }

    const index = activeViewingSessionEntries.findIndex((entry) => (
        entry.sessionId === identity.sessionId
        && (
            identity.serverId == null
            || entry.serverId == null
            || entry.serverId === identity.serverId
        )
    ));
    if (index >= 0) {
        removeActiveViewingSessionEntryAt(index);
    }
};

export const clearActiveViewingSessionsForServerScopeReset = (): void => {
    activeViewingSessionEntries = [];
    visibleSessionRefCounts.clear();
    visibleSessionScopedRefCounts.clear();
    visibleScopedSessionKeysBySessionId.clear();
};

export const markSessionVisible = (sessionId: string, serverId?: string | null): void => {
    const identity = resolveVisibleSessionIdentity(sessionId, serverId);
    if (!identity.sessionId) return;

    visibleSessionRefCounts.set(identity.sessionId, (visibleSessionRefCounts.get(identity.sessionId) ?? 0) + 1);
    if (!identity.sessionKey) return;

    visibleSessionScopedRefCounts.set(
        identity.sessionKey,
        (visibleSessionScopedRefCounts.get(identity.sessionKey) ?? 0) + 1,
    );
    addVisibleScopedSessionKey(identity.sessionId, identity.sessionKey);
};

function decrementVisibleScopedSession(identity: Readonly<{
    sessionId: string;
    sessionKey: string | null;
}>): void {
    const scopedSessionKey = identity.sessionKey
        ?? (
            visibleScopedSessionKeysBySessionId.get(identity.sessionId)?.size === 1
                ? Array.from(visibleScopedSessionKeysBySessionId.get(identity.sessionId) ?? [])[0] ?? null
                : null
        );
    if (!scopedSessionKey) return;

    const currentScoped = visibleSessionScopedRefCounts.get(scopedSessionKey) ?? 0;
    if (currentScoped <= 1) {
        visibleSessionScopedRefCounts.delete(scopedSessionKey);
        removeVisibleScopedSessionKey(identity.sessionId, scopedSessionKey);
        return;
    }
    visibleSessionScopedRefCounts.set(scopedSessionKey, currentScoped - 1);
}

export const markSessionHidden = (sessionId: string, serverId?: string | null): void => {
    const identity = resolveVisibleSessionIdentity(sessionId, serverId);
    if (!identity.sessionId) return;
    const current = visibleSessionRefCounts.get(identity.sessionId) ?? 0;
    if (current <= 1) {
        visibleSessionRefCounts.delete(identity.sessionId);
    } else {
        visibleSessionRefCounts.set(identity.sessionId, current - 1);
    }
    decrementVisibleScopedSession(identity);
};

export const isSessionVisible = (sessionId: string, serverId?: string | null): boolean => {
    const identity = resolveVisibleSessionIdentity(sessionId, serverId);
    if (!identity.sessionId) return false;
    if (identity.sessionKey && visibleSessionScopedRefCounts.has(identity.sessionKey)) {
        return true;
    }

    const hasScopedVisibility = (visibleScopedSessionKeysBySessionId.get(identity.sessionId)?.size ?? 0) > 0;
    if (identity.serverId && hasScopedVisibility) {
        return false;
    }

    return visibleSessionRefCounts.has(identity.sessionId);
};
