import * as React from 'react';
import { useRouter } from 'expo-router';

import { setActiveServerAndSwitch } from '@/sync/domains/server/activeServerSwitch';
import { useAuth } from '@/auth/context/AuthContext';
import { resolveServerIdForSessionIdFromLocalCache } from '@/sync/runtime/orchestration/serverScopedRpc/resolveServerIdForSessionIdFromLocalCache';
import { buildScopedSessionRouteHref } from './sessionRouteServerScope';

export function useNavigateToSession() {
    const router = useRouter();
    const auth = useAuth();

    return React.useCallback(async (sessionId: string, opts?: Readonly<{ serverId?: string }>) => {
        const targetServerId = String(opts?.serverId ?? '').trim() || resolveServerIdForSessionIdFromLocalCache(sessionId);
        if (targetServerId) {
            try {
                await setActiveServerAndSwitch({ serverId: targetServerId, scope: 'device', refreshAuth: auth.refreshFromActiveServer });
            } catch {
                // Keep the explicit server scope on the route so hydration can recover even if the switch failed.
            }
        }

        const href = buildScopedSessionRouteHref({
            sessionId,
            serverId: targetServerId || null,
        });
        router.navigate(href, {
            dangerouslySingular(name, params) {
                return 'session';
            },
        });
    }, [auth.refreshFromActiveServer, router]);
}
