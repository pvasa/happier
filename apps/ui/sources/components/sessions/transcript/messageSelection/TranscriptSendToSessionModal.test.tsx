import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    createSessionFixture,
    createPartialStorageModuleMock,
    createResolveServerIdForSessionIdFromLocalCacheModuleMock,
    renderScreen,
    standardCleanup,
} from '@/dev/testkit';
import type { Session } from '@/sync/domains/state/storageTypes';

import { TranscriptSendToSessionModal } from './TranscriptSendToSessionModal';

const sessionsRef = vi.hoisted((): { current: Session[] } => ({ current: [] }));
const keyboardLayoutState = vi.hoisted(() => ({
    keyboardHeight: 0,
    windowHeight: 800,
    windowWidth: 390,
}));

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock({
        useWindowDimensions: () => ({
            width: keyboardLayoutState.windowWidth,
            height: keyboardLayoutState.windowHeight,
            scale: 1,
            fontScale: 1,
        }),
    });
});

vi.mock('@/hooks/ui/useKeyboardHeight', () => ({
    useKeyboardHeight: () => keyboardLayoutState.keyboardHeight,
}));

vi.mock('@/sync/domains/state/storage', async (importOriginal) => createPartialStorageModuleMock(importOriginal, {
    useSessions: () => sessionsRef.current,
}));

vi.mock(
    '@/sync/runtime/orchestration/serverScopedRpc/resolveServerIdForSessionIdFromLocalCache',
    async (importOriginal) => createResolveServerIdForSessionIdFromLocalCacheModuleMock({
        importOriginal,
        overrides: {
            resolveServerIdForSessionIdFromLocalCache: (sessionId: string) => (
                sessionId === 'cached-same-server' ? 'server-a' : null
            ),
        },
    }),
);

function createNamedMetadata(name: string): Session['metadata'] {
    return {
        path: `/Users/tester/${name.toLowerCase().replace(/\s+/g, '-')}`,
        host: 'tester.local',
        name,
    };
}

function flattenStyle(style: unknown): Record<string, unknown> {
    if (Array.isArray(style)) {
        return Object.assign({}, ...style.filter(Boolean).map(flattenStyle));
    }
    return style && typeof style === 'object' ? style as Record<string, unknown> : {};
}

describe('TranscriptSendToSessionModal', () => {
    afterEach(() => {
        sessionsRef.current = [];
        keyboardLayoutState.keyboardHeight = 0;
        keyboardLayoutState.windowHeight = 800;
        keyboardLayoutState.windowWidth = 390;
        standardCleanup();
    });

    it('lists only destinations with a concrete same-server scope', async () => {
        sessionsRef.current = [
            createSessionFixture({ id: 'source', serverId: 'server-a', metadata: createNamedMetadata('Source') }),
            createSessionFixture({ id: 'same-server', serverId: 'server-a', accessLevel: 'edit', metadata: createNamedMetadata('Same server') }),
            createSessionFixture({ id: 'cached-same-server', accessLevel: 'edit', metadata: createNamedMetadata('Cached same server') }),
            createSessionFixture({ id: 'unknown-server', accessLevel: 'edit', metadata: createNamedMetadata('Unknown server') }),
            createSessionFixture({ id: 'other-server', serverId: 'server-b', accessLevel: 'edit', metadata: createNamedMetadata('Other server') }),
        ];

        const screen = await renderScreen(
            <TranscriptSendToSessionModal
                sourceSessionId="source"
                sourceServerId="server-a"
                previewText="Preview"
                onResolve={vi.fn()}
                onClose={vi.fn()}
            />,
        );

        const renderedText = screen.getTextContent();
        expect(renderedText).toContain('Same server');
        expect(renderedText).toContain('Cached same server');
        expect(renderedText).not.toContain('Unknown server');
        expect(renderedText).not.toContain('Other server');
        expect(renderedText).not.toContain('Source');
    });

    it('reduces the destination list height while the native keyboard is open', async () => {
        keyboardLayoutState.keyboardHeight = 320;
        keyboardLayoutState.windowHeight = 760;
        sessionsRef.current = [
            createSessionFixture({ id: 'source', serverId: 'server-a', metadata: createNamedMetadata('Source') }),
            createSessionFixture({ id: 'same-server', serverId: 'server-a', accessLevel: 'edit', metadata: createNamedMetadata('Same server') }),
        ];

        const screen = await renderScreen(
            <TranscriptSendToSessionModal
                sourceSessionId="source"
                sourceServerId="server-a"
                previewText="Preview"
                onResolve={vi.fn()}
                onClose={vi.fn()}
            />,
        );

        const list = screen.findByTestId('transcript-send-to-session-list');
        if (!list) throw new Error('expected transcript send-to session list to render');
        const listStyle = flattenStyle(list.props.style);
        expect(listStyle.maxHeight).toBeLessThan(360);
        expect(listStyle.maxHeight).toBeGreaterThanOrEqual(160);
    });
});
