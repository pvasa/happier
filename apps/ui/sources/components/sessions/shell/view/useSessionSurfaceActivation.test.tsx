import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { renderHook, standardCleanup } from '@/dev/testkit';
import {
    clearActiveViewingSessionsForServerScopeReset,
    isSessionVisible,
} from '@/sync/domains/session/activeViewingSession';

import { useSessionSurfaceActivation } from './useSessionSurfaceActivation';

describe('useSessionSurfaceActivation', () => {
    beforeEach(() => {
        clearActiveViewingSessionsForServerScopeReset();
    });

    afterEach(() => {
        standardCleanup();
        clearActiveViewingSessionsForServerScopeReset();
    });

    it('marks route-visible surfaces before session content is loaded and scopes them to the server', async () => {
        const hook = await renderHook((input: Parameters<typeof useSessionSurfaceActivation>[0]) => (
            useSessionSurfaceActivation(input)
        ), {
            initialProps: {
                sessionId: 'shared-session',
                serverId: 'server-a',
                surfaceVisible: true,
                surfaceFocused: false,
            },
        });

        expect(hook.getCurrent()).toEqual({
            isSurfaceFocused: false,
            isVisible: true,
        });
        expect(isSessionVisible('shared-session', 'server-a')).toBe(true);
        expect(isSessionVisible('shared-session', 'server-b')).toBe(false);

        await hook.rerender({
            sessionId: 'shared-session',
            serverId: 'server-b',
            surfaceVisible: true,
            surfaceFocused: true,
        });

        expect(hook.getCurrent()).toEqual({
            isSurfaceFocused: true,
            isVisible: true,
        });
        expect(isSessionVisible('shared-session', 'server-a')).toBe(false);
        expect(isSessionVisible('shared-session', 'server-b')).toBe(true);

        await hook.rerender({
            sessionId: 'shared-session',
            serverId: 'server-b',
            surfaceVisible: false,
            surfaceFocused: false,
        });

        expect(hook.getCurrent()).toEqual({
            isSurfaceFocused: false,
            isVisible: false,
        });
        expect(isSessionVisible('shared-session', 'server-b')).toBe(false);
    });
});
