import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const runtimeState = vi.hoisted(() => ({
    appState: 'active',
    platformOs: 'web',
    isTauriDesktop: false,
}));

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock({
        Platform: {
            get OS() {
                return runtimeState.platformOs;
            },
        },
        AppState: {
            get currentState() {
                return runtimeState.appState;
            },
        },
    });
});

vi.mock('@/utils/platform/tauri', () => ({
    isTauriDesktop: () => runtimeState.isTauriDesktop,
}));

describe('isRuntimeActive', () => {
    const globalWithDocument = globalThis as unknown as {
        document?: { visibilityState?: string };
    };
    const originalDocument = globalWithDocument.document;

    beforeEach(() => {
        vi.resetModules();
        runtimeState.appState = 'active';
        runtimeState.platformOs = 'web';
        runtimeState.isTauriDesktop = false;
        globalWithDocument.document = { visibilityState: 'visible' };
    });

    afterEach(() => {
        globalWithDocument.document = originalDocument;
    });

    it('treats browser web as inactive when hidden', async () => {
        globalWithDocument.document = { visibilityState: 'hidden' };

        const { isRuntimeActive } = await import('./isRuntimeActive');

        expect(isRuntimeActive()).toBe(false);
    });

    it('treats Tauri desktop as active when the webview is hidden', async () => {
        runtimeState.isTauriDesktop = true;
        runtimeState.appState = 'background';
        globalWithDocument.document = { visibilityState: 'hidden' };

        const { isRuntimeActive } = await import('./isRuntimeActive');

        expect(isRuntimeActive()).toBe(true);
    });
});
