import * as React from 'react';

import {
    type EnsureSessionVisibleForRouteResult,
    type SessionRouteHydrationState,
} from '@/sync/domains/session/sessionRouteHydrationState';
import { storage } from '@/sync/domains/state/storage';
import { sync } from '@/sync/sync';
import { fireAndForget } from '@/utils/system/fireAndForget';

export type { SessionRouteHydrationState } from '@/sync/domains/session/sessionRouteHydrationState';

export type UseHydrateSessionForRouteOptions = Readonly<{
    serverId?: string;
    forceRefresh?: boolean;
}>;

type SessionRouteHydrationLoadingReason = Extract<
    SessionRouteHydrationState,
    { kind: 'loading' }
>['reason'];

const routeHydrationRetryBaseDelayMs = 2_000;
const routeHydrationRetryMaxDelayMs = 30_000;

function normalizeRouteId(value: unknown): string {
    return String(value ?? '').trim();
}

function withServerId<T extends { sessionId: string }>(state: T, serverId: string): T & { serverId?: string } {
    return serverId ? { ...state, serverId } : state;
}

function createLoadingState(
    sessionId: string,
    serverId: string,
    reason: SessionRouteHydrationLoadingReason,
): SessionRouteHydrationState {
    return withServerId({ kind: 'loading', sessionId, reason }, serverId);
}

function createAvailableState(sessionId: string, serverId: string): SessionRouteHydrationState {
    return withServerId({ kind: 'available', sessionId }, serverId);
}

function createMissingState(result: Extract<EnsureSessionVisibleForRouteResult, { kind: 'missing' }>): SessionRouteHydrationState {
    return result.serverId
        ? { kind: 'missing', sessionId: result.sessionId, serverId: result.serverId, cause: result.cause }
        : { kind: 'missing', sessionId: result.sessionId, cause: result.cause };
}

function createRetryingState(result: Extract<EnsureSessionVisibleForRouteResult, { kind: 'retryable_failure' }>): SessionRouteHydrationState {
    return result.serverId
        ? { kind: 'retrying', sessionId: result.sessionId, serverId: result.serverId, cause: result.cause }
        : { kind: 'retrying', sessionId: result.sessionId, cause: result.cause };
}

function areRouteHydrationStatesEqual(left: SessionRouteHydrationState, right: SessionRouteHydrationState): boolean {
    if (left.kind !== right.kind) return false;
    if (left.sessionId !== right.sessionId) return false;
    if ((left.serverId ?? '') !== (right.serverId ?? '')) return false;
    if (left.kind === 'loading' && right.kind === 'loading') return left.reason === right.reason;
    if (left.kind === 'retrying' && right.kind === 'retrying') return left.cause === right.cause;
    if (left.kind === 'missing' && right.kind === 'missing') return left.cause === right.cause;
    return true;
}

function resolveNextRouteHydrationState(
    current: SessionRouteHydrationState,
    next: SessionRouteHydrationState,
): SessionRouteHydrationState {
    return areRouteHydrationStatesEqual(current, next) ? current : next;
}

function stateMatchesCurrentRoute(
    state: SessionRouteHydrationState,
    sessionId: string,
    serverId: string,
): boolean {
    if (state.sessionId !== sessionId) return false;
    return (state.serverId ?? '') === serverId;
}

export function hasAuthoritativeHydratedSessionForRoute(sessionId: string, serverId?: string | null): boolean {
    const session = storage.getState().sessions[sessionId] ?? null;
    if (!session || session.metadata == null) {
        return false;
    }
    if (serverId && String(session.serverId ?? '').trim() !== serverId) {
        return false;
    }
    if (session.encryptionMode === 'plain') {
        return true;
    }
    try {
        return Boolean(sync.encryption.getSessionEncryption(sessionId));
    } catch {
        return false;
    }
}

function readHydratedRouteSnapshot(sessionId: string, serverId: string): boolean {
    if (!sessionId) return false;
    return hasAuthoritativeHydratedSessionForRoute(sessionId, serverId || null);
}

function resolveRetryDelayMs(attemptCount: number): number {
    return Math.min(
        routeHydrationRetryBaseDelayMs * Math.pow(2, Math.max(0, attemptCount - 1)),
        routeHydrationRetryMaxDelayMs,
    );
}

/**
 * Best-effort hydration for deep links / hard refreshes.
 *
 * Some session sub-routes can be opened directly without mounting the main
 * `SessionView`, which normally ensures the session exists in storage and
 * initializes its encryption state. Route hydration is explicit so consumers
 * can distinguish loading/retrying from terminal missing.
 */
export function useHydrateSessionForRoute(
    sessionId: string,
    tag: string,
    options?: UseHydrateSessionForRouteOptions,
): SessionRouteHydrationState {
    const normalizedSessionId = normalizeRouteId(sessionId);
    const normalizedServerId = normalizeRouteId(options?.serverId);
    const forceRefresh = options?.forceRefresh === true;
    const routeKey = `${normalizedServerId}\n${normalizedSessionId}`;

    const hasHydratedSession = React.useSyncExternalStore(
        storage.subscribe,
        () => readHydratedRouteSnapshot(normalizedSessionId, normalizedServerId),
        () => readHydratedRouteSnapshot(normalizedSessionId, normalizedServerId),
    );

    const [routeState, setRouteState] = React.useState<SessionRouteHydrationState>(() => {
        if (hasHydratedSession) {
            return createAvailableState(normalizedSessionId, normalizedServerId);
        }
        return createLoadingState(normalizedSessionId, normalizedServerId, 'cold');
    });

    React.useEffect(() => {
        let canceled = false;
        let retryTimeoutId: ReturnType<typeof setTimeout> | null = null;
        let attemptCount = 0;

        if (!normalizedSessionId) {
            setRouteState((current) => resolveNextRouteHydrationState(
                current,
                createLoadingState(normalizedSessionId, normalizedServerId, 'cold'),
            ));
            return;
        }

        if (hasHydratedSession && !forceRefresh) {
            return;
        }

        if (!hasHydratedSession || forceRefresh) {
            setRouteState((current) => {
                if (forceRefresh && current.kind === 'available') {
                    return current;
                }
                return resolveNextRouteHydrationState(
                    current,
                    createLoadingState(
                        normalizedSessionId,
                        normalizedServerId,
                        forceRefresh ? 'refreshing' : 'store-miss',
                    ),
                );
            });
        }

        const scheduleRetry = () => {
            const retryDelayMs = resolveRetryDelayMs(attemptCount);
            retryTimeoutId = setTimeout(() => {
                if (!canceled) {
                    attemptHydration();
                }
            }, retryDelayMs);
        };

        const attemptHydration = () => {
            if (canceled) return;

            attemptCount += 1;
            const hydrationOptions = normalizedServerId || forceRefresh
                ? {
                      ...(normalizedServerId ? { serverId: normalizedServerId } : {}),
                      ...(forceRefresh ? { forceRefresh: true } : {}),
                  }
                : undefined;
            const promise = sync.ensureSessionVisibleForMessageRoute(normalizedSessionId, hydrationOptions);
            fireAndForget(promise, { tag });

            void promise
                .then((result) => {
                    if (canceled) return;
                    if (result.kind === 'missing') {
                        setRouteState((current) => resolveNextRouteHydrationState(current, createMissingState(result)));
                        return;
                    }
                    if (result.kind === 'retryable_failure') {
                        setRouteState((current) => resolveNextRouteHydrationState(current, createRetryingState(result)));
                        scheduleRetry();
                        return;
                    }
                    if (readHydratedRouteSnapshot(normalizedSessionId, normalizedServerId)) {
                        setRouteState((current) => resolveNextRouteHydrationState(
                            current,
                            createAvailableState(normalizedSessionId, normalizedServerId),
                        ));
                        return;
                    }
                    setRouteState((current) => resolveNextRouteHydrationState(
                        current,
                        createLoadingState(normalizedSessionId, normalizedServerId, 'refreshing'),
                    ));
                    scheduleRetry();
                })
                .catch(() => {
                    if (canceled) return;
                    setRouteState((current) => resolveNextRouteHydrationState(
                        current,
                        withServerId({
                            kind: 'retrying',
                            sessionId: normalizedSessionId,
                            cause: 'unknown',
                        }, normalizedServerId),
                    ));
                    scheduleRetry();
                });
        };

        attemptHydration();

        return () => {
            canceled = true;
            if (retryTimeoutId !== null) {
                clearTimeout(retryTimeoutId);
            }
        };
    }, [forceRefresh, hasHydratedSession, normalizedServerId, normalizedSessionId, routeKey, tag]);

    if (hasHydratedSession && routeState.kind !== 'missing') {
        return createAvailableState(normalizedSessionId, normalizedServerId);
    }

    if (!stateMatchesCurrentRoute(routeState, normalizedSessionId, normalizedServerId)) {
        return createLoadingState(
            normalizedSessionId,
            normalizedServerId,
            normalizedSessionId ? 'store-miss' : 'cold',
        );
    }

    return routeState;
}
