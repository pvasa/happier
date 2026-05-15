import { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderHook, standardCleanup } from '@/dev/testkit';

const nativeHookState = vi.hoisted(() => ({
    keyboardHandlers: null as null | {
        onEnd?: (event: { height: number; progress: number }) => void;
        onMove?: (event: { height: number; progress: number }) => void;
    },
    windowHeight: 800,
}));

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock({
        useWindowDimensions: () => ({
            width: 390,
            height: nativeHookState.windowHeight,
            scale: 1,
            fontScale: 1,
        }),
    });
});

vi.mock('react-native-keyboard-controller', () => ({
    useKeyboardHandler: (handlers: NonNullable<typeof nativeHookState.keyboardHandlers>) => {
        nativeHookState.keyboardHandlers = handlers;
    },
    useReanimatedKeyboardAnimation: () => ({
        height: { value: 0 },
        progress: { value: 0 },
    }),
}));

vi.mock('react-native-reanimated', async () => {
    const React = await import('react');
    return {
        runOnJS: (callback: (...args: readonly unknown[]) => void) => callback,
        useSharedValue: <T,>(value: T) => React.useRef({ value }).current,
    };
});

describe('useComposerKeyboardLayout native', () => {
    beforeEach(() => {
        standardCleanup();
        nativeHookState.keyboardHandlers = null;
        nativeHookState.windowHeight = 800;
    });

    it('does not subtract the measured composer height from available panel height', async () => {
        const { useComposerKeyboardLayout } = await import('./useComposerKeyboardLayout.native');
        const hook = await renderHook(() => useComposerKeyboardLayout({
            headerHeight: 100,
            safeAreaBottom: 20,
        }));

        act(() => {
            hook.getCurrent().setComposerMeasuredHeight(200);
        });

        expect(hook.getCurrent().availablePanelHeight.value).toBe(680);
    });

    it('updates available panel height when the keyboard settles', async () => {
        const { useComposerKeyboardLayout } = await import('./useComposerKeyboardLayout.native');
        const hook = await renderHook(() => useComposerKeyboardLayout({
            headerHeight: 100,
            safeAreaBottom: 20,
        }));

        act(() => {
            nativeHookState.keyboardHandlers?.onEnd?.({ height: 300, progress: 1 });
        });

        expect(hook.getCurrent().availablePanelHeight.value).toBe(400);
    });

    it('normalizes keyboard lift relative to mounted bottom chrome below the scaffold', async () => {
        const { useComposerKeyboardLayout } = await import('./useComposerKeyboardLayout.native');
        const hook = await renderHook(() => useComposerKeyboardLayout({
            headerHeight: 100,
            layoutBottomInset: 80,
            safeAreaBottom: 0,
        }));

        expect(hook.getCurrent().availablePanelHeight.value).toBe(620);

        act(() => {
            nativeHookState.keyboardHandlers?.onEnd?.({ height: 300, progress: 1 });
        });

        expect(hook.getCurrent().bottomInset.value).toBe(220);
        expect(hook.getCurrent().availablePanelHeight.value).toBe(400);
    });

    it('notifies React bridge subscribers when the keyboard settles', async () => {
        const { useComposerKeyboardLayout } = await import('./useComposerKeyboardLayout.native');
        const hook = await renderHook(() => useComposerKeyboardLayout({
            headerHeight: 100,
            safeAreaBottom: 20,
        }));
        const heights: number[] = [];
        const unsubscribe = hook.getCurrent().subscribeAvailablePanelHeight?.((height) => {
            heights.push(height);
        });

        act(() => {
            nativeHookState.keyboardHandlers?.onEnd?.({ height: 300, progress: 1 });
        });

        unsubscribe?.();
        expect(heights.at(-1)).toBe(400);
    });

    it('keeps public inset height current during normal keyboard movement', async () => {
        const { useComposerKeyboardLayout } = await import('./useComposerKeyboardLayout.native');
        const hook = await renderHook(() => useComposerKeyboardLayout({
            headerHeight: 100,
            safeAreaBottom: 20,
        }));

        act(() => {
            nativeHookState.keyboardHandlers?.onMove?.({ height: 240, progress: 0.8 });
        });

        expect(hook.getCurrent().keyboardHeightForInset.value).toBe(240);
        expect(hook.getCurrent().listBottomInset.value).toBe(240);
    });

    it('rests after modal-owned keyboard events when suppression clears', async () => {
        const { useComposerKeyboardLayout } = await import('./useComposerKeyboardLayout.native');
        const hook = await renderHook(
            ({ keyboardLiftSuppressed }: { keyboardLiftSuppressed: boolean }) => useComposerKeyboardLayout({
                headerHeight: 100,
                keyboardLiftSuppressed,
                safeAreaBottom: 20,
            }),
            { initialProps: { keyboardLiftSuppressed: true } },
        );

        act(() => {
            hook.getCurrent().setComposerMeasuredHeight(120);
        });
        act(() => {
            nativeHookState.keyboardHandlers?.onEnd?.({ height: 300, progress: 1 });
        });

        expect(hook.getCurrent().keyboardHeightLive.value).toBe(0);
        expect(hook.getCurrent().keyboardHeightForInset.value).toBe(0);
        expect(hook.getCurrent().bottomInset.value).toBe(20);
        expect(hook.getCurrent().listBottomInset.value).toBe(140);

        await hook.rerender({ keyboardLiftSuppressed: false });

        expect(hook.getCurrent().bottomInset.value).toBe(20);
        expect(hook.getCurrent().listBottomInset.value).toBe(140);
        expect(hook.getCurrent().availablePanelHeight.value).toBe(680);
    });

    it('retains the previous keyboard lift while a composer overlay transfers focus', async () => {
        const { useComposerKeyboardLayout } = await import('./useComposerKeyboardLayout.native');
        const hook = await renderHook(() => useComposerKeyboardLayout({
            headerHeight: 100,
            layoutBottomInset: 80,
            safeAreaBottom: 0,
        }));

        act(() => {
            hook.getCurrent().setComposerMeasuredHeight(140);
        });
        act(() => {
            nativeHookState.keyboardHandlers?.onEnd?.({ height: 300, progress: 1 });
        });

        const retention = hook.getCurrent() as unknown as {
            retainKeyboardLift?: () => () => void;
        };
        expect(retention.retainKeyboardLift).toBeTypeOf('function');
        const release = retention.retainKeyboardLift?.();

        act(() => {
            nativeHookState.keyboardHandlers?.onEnd?.({ height: 0, progress: 0 });
        });

        expect(hook.getCurrent().bottomInset.value).toBe(220);
        expect(hook.getCurrent().keyboardHeightLive.value).toBe(220);
        expect(hook.getCurrent().listBottomInset.value).toBe(360);

        act(() => {
            release?.();
        });

        expect(hook.getCurrent().bottomInset.value).toBe(0);
        expect(hook.getCurrent().keyboardHeightLive.value).toBe(0);
        expect(hook.getCurrent().listBottomInset.value).toBe(140);
    });
});
