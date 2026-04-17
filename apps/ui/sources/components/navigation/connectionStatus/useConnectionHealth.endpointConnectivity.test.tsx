import * as React from 'react';
import { describe, expect, it } from 'vitest';

import { renderHook } from '@/dev/testkit';
import { installConnectionStatusCommonModuleMocks } from './connectionStatusTestHelpers';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let endpointStatus: import('@happier-dev/connection-supervisor').ManagedConnectionPhase = 'online';
let socketStatus: import('./connectionHealthTypes').ConnectionSocketStatus = 'connected';
let syncErrorKind: 'auth' | 'network' | null = null;
let syncErrorServerId: string | null = null;
let machines: Array<Record<string, unknown>> = [];

installConnectionStatusCommonModuleMocks({
    activeSelectionMachineGroups: () => ({
        useActiveSelectionMachineGroups: () => ({
            visibleMachineGroups: [{ status: 'idle', machines }],
        }),
    }),
    serverProfiles: () => ({
        getActiveServerSnapshot: () => ({ serverId: 'server-a', generation: 1 }),
        listServerProfiles: () => [{ id: 'server-a', name: 'Server A', serverUrl: 'https://api.example.test' }],
    }),
    storage: async (importOriginal) => {
        const { createPartialStorageModuleMock } = await import('@/dev/testkit/mocks/storage');
        return createPartialStorageModuleMock(importOriginal, {
            useEndpointConnectivity: () => ({
                status: endpointStatus,
                reason: null,
                attempt: 0,
                nextRetryAt: null,
                lastConnectedAt: null,
                lastDisconnectedAt: null,
                lastErrorMessage: null,
            }),
            useSocketStatus: () => ({ status: socketStatus }),
            useSyncError: () =>
                syncErrorKind
                    ? {
                        message: 'boom',
                        retryable: syncErrorKind !== 'auth',
                        kind: syncErrorKind,
                        at: Date.now(),
                        ...(syncErrorServerId ? { serverId: syncErrorServerId } : {}),
                    }
                    : null,
            useAllMachines: () => [],
            useMachineListByServerId: () => ({}),
            useMachineListStatusByServerId: () => ({}),
            useSetting: () => null,
        });
    },
});

describe('useConnectionHealth (endpoint connectivity integration)', () => {
    it('prioritizes endpoint offline over socket connected + sync errors', async () => {
        endpointStatus = 'offline';
        socketStatus = 'connected';
        syncErrorKind = 'network';
        machines = [];

        const { useConnectionHealth } = await import('./useConnectionHealth');
        const hook = await renderHook(() => useConnectionHealth());

        expect(hook.getCurrent().kind).toBe('server_unreachable');
    });

    it('surfaces auth_required when endpoint auth_failed', async () => {
        endpointStatus = 'auth_failed';
        socketStatus = 'connected';
        syncErrorKind = null;
        machines = [];

        const { useConnectionHealth } = await import('./useConnectionHealth');
        const hook = await renderHook(() => useConnectionHealth());

        expect(hook.getCurrent().kind).toBe('auth_required');
        expect(hook.getCurrent().statusLabelKey).toBe('status.actionRequired');
    });

    it('surfaces auth_required when a terminal auth sync error is present', async () => {
        endpointStatus = 'online';
        socketStatus = 'error';
        syncErrorKind = 'auth';
        syncErrorServerId = null;
        machines = [];

        const { useConnectionHealth } = await import('./useConnectionHealth');
        const hook = await renderHook(() => useConnectionHealth());

        expect(hook.getCurrent().kind).toBe('auth_required');
        expect(hook.getCurrent().statusLabelKey).toBe('status.actionRequired');
    });

    it('ignores auth sync errors that belong to a different server profile', async () => {
        endpointStatus = 'online';
        socketStatus = 'connected';
        syncErrorKind = 'auth';
        syncErrorServerId = 'server-b';
        machines = [];

        const { useConnectionHealth } = await import('./useConnectionHealth');
        const hook = await renderHook(() => useConnectionHealth());

        expect(hook.getCurrent().kind).toBe('no_machine');
    });

    it('surfaces machine_not_ready when machines are online but none are ready', async () => {
        endpointStatus = 'online';
        socketStatus = 'connected';
        syncErrorKind = null;
        machines = [
            { id: 'm1', active: true, activeAt: Date.now(), revokedAt: null, daemonState: { status: 'offline' } },
            { id: 'm2', active: true, activeAt: Date.now(), revokedAt: null, daemonState: { status: 'offline' } },
        ];

        const { useConnectionHealth } = await import('./useConnectionHealth');
        const hook = await renderHook(() => useConnectionHealth());

        expect(hook.getCurrent().kind).toBe('machine_not_ready');
        expect(hook.getCurrent().statusLabelKey).toBe('status.actionRequired');
        expect(hook.getCurrent().machineLabelKey).toBe('status.online');
    });
});
