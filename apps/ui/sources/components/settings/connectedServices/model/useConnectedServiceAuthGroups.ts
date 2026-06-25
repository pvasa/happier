import * as React from 'react';

import { useAuth } from '@/auth/context/AuthContext';
import { Modal } from '@/modal';
import { sync } from '@/sync/sync';
import {
    createConnectedServiceAuthGroupV3,
    listConnectedServiceAuthGroupsV3,
} from '@/sync/api/account/apiConnectedServiceAuthGroupsV3';
import { deriveConnectedServiceAuthGroupIdFromName } from '@/sync/domains/connectedServices/deriveConnectedServiceAuthGroupIdFromName';
import { t } from '@/text';
import type { ConnectedServiceAuthGroupV1, ConnectedServiceId } from '@happier-dev/protocol';

import { resolveConnectedServiceSettingsErrorMessage } from '../errors/connectedServiceSettingsErrors';
import {
    useConnectedServiceGroupsRefreshSignal,
} from '../connectedServiceGroupsRefreshSignal';

export type ConnectedServiceAuthGroupsLoadStatus = 'idle' | 'loading' | 'refreshing' | 'loaded' | 'error';

const CONNECTED_SERVICE_AUTH_GROUPS_LOAD_STATUS_KEY = '__connectedServiceAuthGroupsLoadStatus';

type GroupsWithLoadStatus = ReadonlyArray<ConnectedServiceAuthGroupV1> & Readonly<{
    [CONNECTED_SERVICE_AUTH_GROUPS_LOAD_STATUS_KEY]?: ConnectedServiceAuthGroupsLoadStatus;
}>;

type ConnectedServiceAuthGroupsState = Readonly<{
    groups: ReadonlyArray<ConnectedServiceAuthGroupV1>;
    loadStatus: ConnectedServiceAuthGroupsLoadStatus;
    hasLoaded: boolean;
}>;

const emptyGroupsState: ConnectedServiceAuthGroupsState = {
    groups: [],
    loadStatus: 'idle',
    hasLoaded: false,
};

function withConnectedServiceAuthGroupsLoadStatus(
    groups: ReadonlyArray<ConnectedServiceAuthGroupV1>,
    loadStatus: ConnectedServiceAuthGroupsLoadStatus,
): GroupsWithLoadStatus {
    const tagged = groups.slice() as ConnectedServiceAuthGroupV1[] & {
        [CONNECTED_SERVICE_AUTH_GROUPS_LOAD_STATUS_KEY]?: ConnectedServiceAuthGroupsLoadStatus;
    };
    Object.defineProperty(tagged, CONNECTED_SERVICE_AUTH_GROUPS_LOAD_STATUS_KEY, {
        value: loadStatus,
        enumerable: false,
        configurable: true,
    });
    return tagged;
}

export function readConnectedServiceAuthGroupsLoadStatus(value: unknown): ConnectedServiceAuthGroupsLoadStatus | undefined {
    if (!Array.isArray(value)) return undefined;
    const tagged = value as {
        [CONNECTED_SERVICE_AUTH_GROUPS_LOAD_STATUS_KEY]?: unknown;
    };
    const status = tagged[CONNECTED_SERVICE_AUTH_GROUPS_LOAD_STATUS_KEY];
    return status === 'idle'
        || status === 'loading'
        || status === 'refreshing'
        || status === 'loaded'
        || status === 'error'
        ? status
        : undefined;
}

export type UseConnectedServiceAuthGroupsParams = Readonly<{
    serviceId: ConnectedServiceId | null;
    accountGroupsEnabled: boolean;
    /** Per-provider runtime capability: whether pools can be configured at all. */
    groupConfigurationSupported: boolean;
    runtimeGroupFallbackSupported: boolean;
    /**
     * Structural signature of the projected service (profiles + groups) so the
     * authoritative refetch re-runs when the projection meaningfully changes.
     */
    serviceProjectionSignature: string;
}>;

export type UseConnectedServiceAuthGroupsResult = Readonly<{
    /** Authoritative groups loaded from `listConnectedServiceAuthGroupsV3`. */
    groups: ReadonlyArray<ConnectedServiceAuthGroupV1>;
    /** Explicit status so list UIs can distinguish loading/refreshing from authoritative empty. */
    loadStatus: ConnectedServiceAuthGroupsLoadStatus;
    /** Refetch the authoritative groups (after a mutation completes elsewhere). */
    refresh: () => Promise<ReadonlyArray<ConnectedServiceAuthGroupV1>>;
    /** Create a new pool ("auth group"). No-op when configuration is unsupported. */
    createPool: () => Promise<void>;
}>;

/**
 * Owns the per-provider authoritative auth-group ("pool") read path + the
 * create-pool mutation extracted from `ConnectedServiceDetailView`. Member and
 * policy mutations live in `PoolDetailView` (its own controller); the segmented
 * shell only needs the group list + create flow. Wire symbols stay
 * `group`/`AuthGroup`/`groupId`; "pool" is the user-facing surface name.
 */
export function useConnectedServiceAuthGroups(
    params: UseConnectedServiceAuthGroupsParams,
): UseConnectedServiceAuthGroupsResult {
    const {
        serviceId,
        accountGroupsEnabled,
        groupConfigurationSupported,
        serviceProjectionSignature,
    } = params;
    const auth = useAuth();
    const authCredentials = auth.credentials ?? null;
    const groupsRefreshSignal = useConnectedServiceGroupsRefreshSignal();
    const [state, setState] = React.useState<ConnectedServiceAuthGroupsState>(emptyGroupsState);
    const groups = React.useMemo(
        () => withConnectedServiceAuthGroupsLoadStatus(state.groups, state.loadStatus),
        [state.groups, state.loadStatus],
    );
    const loadedServiceIdRef = React.useRef<ConnectedServiceId | null>(null);

    const ensureCredentials = React.useCallback(() => {
        if (!auth.credentials) {
            throw new Error('Not authenticated');
        }
        return auth.credentials;
    }, [auth]);

    const fetchGroups = React.useCallback(async () => {
        if (!serviceId || !accountGroupsEnabled || !authCredentials) return [];
        return await listConnectedServiceAuthGroupsV3(authCredentials, { serviceId });
    }, [accountGroupsEnabled, authCredentials, serviceId]);

    const refresh = React.useCallback(async () => {
        setState((prev) => ({
            ...prev,
            loadStatus: prev.hasLoaded || prev.groups.length > 0 ? 'refreshing' : 'loading',
        }));
        try {
            const next = await fetchGroups();
            setState({ groups: next, loadStatus: 'loaded', hasLoaded: true });
            return next;
        } catch (error) {
            setState((prev) => ({
                groups: prev.hasLoaded ? prev.groups : [],
                loadStatus: 'error',
                hasLoaded: prev.hasLoaded,
            }));
            throw error;
        }
    }, [fetchGroups]);

    React.useEffect(() => {
        let cancelled = false;

        if (!serviceId || !accountGroupsEnabled || !authCredentials) {
            loadedServiceIdRef.current = serviceId;
            setState(emptyGroupsState);
            return () => {
                cancelled = true;
            };
        }

        const serviceChanged = loadedServiceIdRef.current !== serviceId;
        loadedServiceIdRef.current = serviceId;
        setState((prev) => ({
            groups: serviceChanged ? [] : prev.groups,
            hasLoaded: serviceChanged ? false : prev.hasLoaded,
            loadStatus: serviceChanged || (!prev.hasLoaded && prev.groups.length === 0) ? 'loading' : 'refreshing',
        }));
        void (async () => {
            try {
                const next = await fetchGroups();
                if (!cancelled) setState({ groups: next, loadStatus: 'loaded', hasLoaded: true });
            } catch {
                if (!cancelled) {
                    setState((prev) => ({
                        groups: prev.hasLoaded ? prev.groups : [],
                        loadStatus: 'error',
                        hasLoaded: prev.hasLoaded,
                    }));
                }
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [accountGroupsEnabled, authCredentials, fetchGroups, groupsRefreshSignal, serviceId, serviceProjectionSignature]);

    const upsertGroup = React.useCallback((group: ConnectedServiceAuthGroupV1) => {
        setState((prev) => {
            const index = prev.groups.findIndex((candidate) => candidate.groupId === group.groupId);
            const next = index === -1 ? [...prev.groups, group] : [...prev.groups];
            if (index !== -1) {
                next[index] = group;
            }
            return {
                groups: next,
                loadStatus: 'loaded',
                hasLoaded: true,
            };
        });
    }, []);

    const createPool = React.useCallback(async () => {
        if (!serviceId || !accountGroupsEnabled || !groupConfigurationSupported) {
            return;
        }
        const res = await Modal.prompt(
            t('connectedServices.detail.groupActions.createTitle'),
            t('connectedServices.detail.groupActions.createSubtitle'),
            {
                placeholder: t('connectedServices.detail.groupActions.displayNamePlaceholder'),
                confirmText: t('common.create'),
                cancelText: t('common.cancel'),
            },
        );
        const displayName = typeof res === 'string' ? res.trim() : '';
        if (!displayName) return;
        const existingGroupIds = groups.map((group) => group.groupId);
        const groupId = deriveConnectedServiceAuthGroupIdFromName({ name: displayName, existingGroupIds })
            ?? deriveConnectedServiceAuthGroupIdFromName({ name: 'group', existingGroupIds });
        if (!groupId) {
            await Modal.alert(
                t('connectedServices.detail.groupActions.invalidGroupIdTitle'),
                t('connectedServices.detail.groupActions.invalidGroupIdBody'),
            );
            return;
        }
        try {
            const created = await createConnectedServiceAuthGroupV3(ensureCredentials(), {
                serviceId,
                groupId,
                displayName,
                members: [],
                activeProfileId: null,
            });
            await sync.refreshProfile().catch(() => undefined);
            await refresh().catch(() => undefined);
            upsertGroup(created);
        } catch (e: unknown) {
            await Modal.alert(t('common.error'), resolveConnectedServiceSettingsErrorMessage(e));
        }
    }, [
        accountGroupsEnabled,
        ensureCredentials,
        groupConfigurationSupported,
        groups,
        refresh,
        serviceId,
        upsertGroup,
    ]);

    return { groups, loadStatus: state.loadStatus, refresh, createPool };
}
