import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderScreen, standardCleanup } from '@/dev/testkit';
import { installSessionShellCommonModuleMocks } from './sessionShellTestHelpers';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const sessionListState = vi.hoisted(() => ({
    data: [] as any[] | null,
    storageKinds: [] as string[],
    paneOptions: [] as Array<{ activeSessionId?: string | null } | undefined>,
    paneHookCalls: 0,
}));
const routeState = vi.hoisted(() => ({
    pathname: '/session/session-1',
}));
const emptyStateState = vi.hoisted(() => ({
    hasHiddenInactiveSessions: false,
}));
const featureDecisionState = vi.hoisted(() => ({
    enabled: false,
}));
const storageKindState = vi.hoisted(() => ({
    storageKind: 'persisted' as 'persisted' | 'direct',
    setStorageKind: vi.fn(),
}));

installSessionShellCommonModuleMocks({
    reactNative: async () => {
        const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
        return createReactNativeWebMock({
            View: 'View',
            ActivityIndicator: 'ActivityIndicator',
        });
    },
    unistyles: async () => {
        const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
        return createUnistylesMock({
            theme: {
                textSecondary: '#777',
                groupped: { background: '#fff' },
            },
        });
    },
    router: async () => {
        const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
        return createExpoRouterMock({
            pathname: () => routeState.pathname,
        }).module;
    },
});
vi.mock('@/hooks/session/useVisibleSessionListViewData', () => ({
    useVisibleSessionListViewData: (storageKind?: string) => {
        sessionListState.storageKinds.push(storageKind ?? 'all');
        return sessionListState.data;
    },
    useVisibleSessionListPaneState: (storageKind?: string, options?: { activeSessionId?: string | null }) => {
        sessionListState.paneHookCalls += 1;
        sessionListState.storageKinds.push(storageKind ?? 'all');
        sessionListState.paneOptions.push(options);
        return {
            sessionListViewData: sessionListState.data,
            visibleSessionCount: sessionListState.data?.reduce((count, item) => count + (item.type === 'session' ? 1 : 0), 0) ?? 0,
            hasHiddenInactiveSessions: emptyStateState.hasHiddenInactiveSessions,
        };
    },
    useHasHiddenInactiveSessions: () => emptyStateState.hasHiddenInactiveSessions,
    countVisibleSessionListSessions: (data: Array<{ type?: string }> | null) => (
        data?.reduce((count, item) => count + (item.type === 'session' ? 1 : 0), 0) ?? 0
    ),
}));
vi.mock('@/components/sessions/model/useSessionListStorageKind', () => ({
    useSessionListStorageKind: () => ({
        directSessionsEnabled: featureDecisionState.enabled,
        storageKind: featureDecisionState.enabled ? storageKindState.storageKind : 'persisted',
        setStorageKind: storageKindState.setStorageKind,
    }),
}));
vi.mock('@/components/sessions/shell/SessionsListStorageChrome', () => ({
    SessionsListStorageChrome: (props: any) => React.createElement('SessionsListStorageChrome', props),
}));
vi.mock('@/components/sessions/guidance/SessionGettingStartedGuidance', () => ({
    SessionGettingStartedGuidance: 'SessionGettingStartedGuidance',
}));
vi.mock('@/components/sessions/guidance/HiddenInactiveSessionsEmptyState', () => ({
    HiddenInactiveSessionsEmptyState: 'HiddenInactiveSessionsEmptyState',
}));
vi.mock('@/components/sessions/shell/SessionsList', () => ({
    SessionsList: (props: any) => React.createElement('SessionsList', props),
    SessionsListContent: (props: any) => React.createElement('SessionsListContent', props),
}));

async function renderSessionsListWrapper() {
    const { SessionsListWrapper } = await import('./SessionsListWrapper');
    return renderScreen(<SessionsListWrapper />);
}

describe('SessionsListWrapper (empty state)', () => {
    beforeEach(() => {
        sessionListState.data = [];
        sessionListState.storageKinds = [];
        sessionListState.paneOptions = [];
        sessionListState.paneHookCalls = 0;
        routeState.pathname = '/session/session-1';
        emptyStateState.hasHiddenInactiveSessions = false;
        featureDecisionState.enabled = false;
        storageKindState.storageKind = 'persisted';
        storageKindState.setStorageKind.mockReset();
    });

    afterEach(() => {
        standardCleanup();
    });

    it('renders getting started guidance when there are no sessions', async () => {
        const screen = await renderSessionsListWrapper();

        expect(() => screen.findByType('SessionGettingStartedGuidance' as any)).not.toThrow();

        await screen.unmount();
    });

    it('uses the persisted storage filter when direct sessions are disabled', async () => {
        const screen = await renderSessionsListWrapper();

        expect(sessionListState.storageKinds).toEqual(['persisted']);

        await screen.unmount();
    });

    it('shows storage tabs and uses the selected direct storage filter when direct sessions are enabled', async () => {
        featureDecisionState.enabled = true;
        storageKindState.storageKind = 'direct';
        sessionListState.data = [{ type: 'session', session: { id: 'session-1' } }];

        const screen = await renderSessionsListWrapper();

        expect(sessionListState.storageKinds).toEqual(['direct']);
        expect(() => screen.findByType('SessionsListStorageChrome' as any)).not.toThrow();
        expect(screen.findByType('SessionsListStorageChrome' as any).props.storageKind).toBe('direct');
        expect(screen.findByType('SessionsListContent' as any).props.storageKind).toBe('direct');
        expect(screen.findByType('SessionsListContent' as any).props.data).toBe(sessionListState.data);

        await screen.unmount();
    });

    it('keeps the storage chrome visible in the direct empty state', async () => {
        featureDecisionState.enabled = true;
        storageKindState.storageKind = 'direct';
        sessionListState.data = [];

        const screen = await renderSessionsListWrapper();

        expect(() => screen.findByType('SessionsListStorageChrome' as any)).not.toThrow();
        expect(screen.findByType('SessionsListStorageChrome' as any).props.storageKind).toBe('direct');

        await screen.unmount();
    });

    it('renders the hidden inactive sessions notice when the filter hides every session', async () => {
        emptyStateState.hasHiddenInactiveSessions = true;

        const screen = await renderSessionsListWrapper();

        expect(() => screen.findByType('HiddenInactiveSessionsEmptyState' as any)).not.toThrow();
        expect(() => screen.findByType('SessionGettingStartedGuidance' as any)).toThrow();

        await screen.unmount();
    });

    it('treats header-only list data as empty when hidden inactive sessions removed all actual session rows', async () => {
        emptyStateState.hasHiddenInactiveSessions = true;
        sessionListState.data = [{ type: 'header', title: 'Today' }];

        const screen = await renderSessionsListWrapper();

        expect(() => screen.findByType('HiddenInactiveSessionsEmptyState' as any)).not.toThrow();
        expect(() => screen.findByType('SessionsListContent' as any)).toThrow();

        await screen.unmount();
    });

    it('keeps the storage chrome visible when the direct tab already has sessions', async () => {
        featureDecisionState.enabled = true;
        storageKindState.storageKind = 'direct';
        sessionListState.data = [{ type: 'session', session: { id: 'session-1' } }];

        const screen = await renderSessionsListWrapper();

        expect(() => screen.findByType('SessionsListStorageChrome' as any)).not.toThrow();
        expect(screen.findByType('SessionsListStorageChrome' as any).props.storageKind).toBe('direct');
        expect(screen.findByType('SessionsListContent' as any).props.storageKind).toBe('direct');

        await screen.unmount();
    });

    it('passes the precomputed visible list to the rendered sessions list path', async () => {
        featureDecisionState.enabled = true;
        storageKindState.storageKind = 'direct';
        sessionListState.data = [{ type: 'session', session: { id: 'session-1' } }];

        const screen = await renderSessionsListWrapper();

        expect(sessionListState.paneHookCalls).toBe(1);
        expect(sessionListState.storageKinds).toEqual(['direct']);
        expect(screen.findByType('SessionsListContent' as any).props.data).toBe(sessionListState.data);

        await screen.unmount();
    });

    it('passes active-session options into the pane state hook for attention-row stability', async () => {
        sessionListState.data = [{ type: 'session', session: { id: 'session-2' } }];
        routeState.pathname = '/session/session-2';

        const screen = await renderSessionsListWrapper();

        expect(sessionListState.paneOptions).toEqual([{ activeSessionId: 'session-2' }]);

        await screen.unmount();
    });
});
