import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CONSTRAINED_MAX_WIDTH_PX_BY_VIEWPORT_CLASS } from '@/utils/platform/viewportClass';

const layoutState = vi.hoisted(() => ({
    isMac: false,
    isTauriDesktop: false,
    platformOs: 'web' as 'ios' | 'android' | 'web',
    windowDimensions: { width: 2048, height: 687 },
}));

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock({
        Platform: {
            get OS() {
                return layoutState.platformOs;
            },
            select: (options: Record<string, unknown>) =>
                options?.[layoutState.platformOs] ?? options?.default ?? options?.ios ?? options?.android,
        },
        Dimensions: {
            get: () => ({
                width: layoutState.windowDimensions.width,
                height: layoutState.windowDimensions.height,
                scale: 2,
                fontScale: 1,
            }),
        },
    });
});

vi.mock('@/utils/platform/platform', () => ({
    isRunningOnMac: () => layoutState.isMac,
}));

vi.mock('@/utils/platform/tauri', () => ({
    isTauriDesktop: () => layoutState.isTauriDesktop,
}));

describe('layout', () => {
    beforeEach(() => {
        vi.resetModules();
        layoutState.isMac = false;
        layoutState.isTauriDesktop = false;
        layoutState.platformOs = 'web';
        layoutState.windowDimensions = { width: 2048, height: 687 };
    });

    it('uses the viewport class content width in Tauri desktop windows', async () => {
        layoutState.isTauriDesktop = true;

        const { layout } = await import('./layout');

        expect(layout.maxWidth).toBe(CONSTRAINED_MAX_WIDTH_PX_BY_VIEWPORT_CLASS.medium);
    });
});
