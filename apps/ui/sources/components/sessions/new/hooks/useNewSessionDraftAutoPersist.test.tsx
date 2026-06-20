import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { flushHookEffects, renderHook } from '@/dev/testkit';
import { WEB_TEXTAREA_AUTOSIZE_VALUE_LENGTH_LIMIT } from '@/components/ui/forms/largeTextInputPolicy';

import { useNewSessionDraftAutoPersist } from './useNewSessionDraftAutoPersist';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-native', async () => {
    const actual = await vi.importActual<typeof import('react-native')>('react-native');
    return {
        ...actual,
        Platform: {
            ...actual.Platform,
            OS: 'web',
        },
    };
});

describe('useNewSessionDraftAutoPersist', () => {
    it('flushes the pending persist callback on unmount', async () => {
        const persistDraftNow = vi.fn();

        const hook = await renderHook(() =>
            useNewSessionDraftAutoPersist({
                persistDraftNow,
            }),
        );

        // Unmount before the debounce timer fires.
        await hook.unmount();

        expect(persistDraftNow).toHaveBeenCalledTimes(1);
    });

    it('does not flush a pending persist callback after persistence is disabled', async () => {
        const persistDraftNow = vi.fn();
        let persistenceEnabled = true;

        vi.useFakeTimers();
        try {
            const hook = await renderHook(() =>
                useNewSessionDraftAutoPersist({
                    persistDraftNow,
                    persistenceEnabled,
                }),
            );

            persistenceEnabled = false;
            await hook.rerender();
            await flushHookEffects({ runAllTimers: true });
            await hook.unmount();
        } finally {
            vi.useRealTimers();
        }

        expect(persistDraftNow).not.toHaveBeenCalled();
    });

    it('defers large web draft persistence beyond the short debounce and until idle', async () => {
        const persistDraftNow = vi.fn();
        const idleCallbacks: Array<() => void> = [];
        const originalRequestIdleCallback = globalThis.requestIdleCallback;
        const originalCancelIdleCallback = globalThis.cancelIdleCallback;

        globalThis.requestIdleCallback = vi.fn((callback: IdleRequestCallback) => {
            idleCallbacks.push(() => callback({ didTimeout: false, timeRemaining: () => 10 }));
            return idleCallbacks.length;
        });
        globalThis.cancelIdleCallback = vi.fn();

        vi.useFakeTimers();
        try {
            const hook = await renderHook(() =>
                useNewSessionDraftAutoPersist({
                    persistDraftNow,
                    draftTextLength: WEB_TEXTAREA_AUTOSIZE_VALUE_LENGTH_LIMIT + 1,
                }),
            );

            await vi.advanceTimersByTimeAsync(250);
            expect(persistDraftNow).not.toHaveBeenCalled();
            expect(idleCallbacks).toHaveLength(0);

            await vi.advanceTimersByTimeAsync(250);
            expect(persistDraftNow).not.toHaveBeenCalled();
            expect(idleCallbacks).toHaveLength(1);

            idleCallbacks[0]?.();
            expect(persistDraftNow).toHaveBeenCalledTimes(1);

            await hook.unmount();
        } finally {
            vi.useRealTimers();
            globalThis.requestIdleCallback = originalRequestIdleCallback;
            globalThis.cancelIdleCallback = originalCancelIdleCallback;
        }
    });

    it('schedules large web draft persistence on unmount without synchronously serializing it', async () => {
        const persistDraftNow = vi.fn();
        const idleCallbacks: Array<() => void> = [];
        const originalRequestIdleCallback = globalThis.requestIdleCallback;
        const originalCancelIdleCallback = globalThis.cancelIdleCallback;

        globalThis.requestIdleCallback = vi.fn((callback: IdleRequestCallback) => {
            idleCallbacks.push(() => callback({ didTimeout: false, timeRemaining: () => 10 }));
            return idleCallbacks.length;
        });
        globalThis.cancelIdleCallback = vi.fn();

        vi.useFakeTimers();
        try {
            const hook = await renderHook(() =>
                useNewSessionDraftAutoPersist({
                    persistDraftNow,
                    draftTextLength: WEB_TEXTAREA_AUTOSIZE_VALUE_LENGTH_LIMIT + 1,
                }),
            );

            await hook.unmount();

            expect(persistDraftNow).not.toHaveBeenCalled();
            expect(idleCallbacks).toHaveLength(1);

            idleCallbacks[0]?.();
            expect(persistDraftNow).toHaveBeenCalledTimes(1);
        } finally {
            vi.useRealTimers();
            globalThis.requestIdleCallback = originalRequestIdleCallback;
            globalThis.cancelIdleCallback = originalCancelIdleCallback;
        }
    });

    it('cancels stale large web idle persistence when the draft changes before idle runs', async () => {
        const persistDraftNow = vi.fn();
        const idleCallbacks: Array<() => void> = [];
        const originalRequestIdleCallback = globalThis.requestIdleCallback;
        const originalCancelIdleCallback = globalThis.cancelIdleCallback;

        globalThis.requestIdleCallback = vi.fn((callback: IdleRequestCallback) => {
            idleCallbacks.push(() => callback({ didTimeout: false, timeRemaining: () => 10 }));
            return idleCallbacks.length;
        });
        globalThis.cancelIdleCallback = vi.fn();

        vi.useFakeTimers();
        try {
            let draftTextLength = WEB_TEXTAREA_AUTOSIZE_VALUE_LENGTH_LIMIT + 1;
            const hook = await renderHook(() =>
                useNewSessionDraftAutoPersist({
                    persistDraftNow,
                    draftTextLength,
                }),
            );

            await vi.advanceTimersByTimeAsync(500);
            expect(idleCallbacks).toHaveLength(1);
            expect(persistDraftNow).not.toHaveBeenCalled();

            draftTextLength = WEB_TEXTAREA_AUTOSIZE_VALUE_LENGTH_LIMIT + 2;
            await hook.rerender();

            expect(globalThis.cancelIdleCallback).toHaveBeenCalledWith(1);

            await vi.advanceTimersByTimeAsync(500);
            expect(idleCallbacks).toHaveLength(2);

            idleCallbacks[0]?.();
            idleCallbacks[1]?.();

            expect(persistDraftNow).toHaveBeenCalledTimes(1);

            await hook.unmount();
        } finally {
            vi.useRealTimers();
            globalThis.requestIdleCallback = originalRequestIdleCallback;
            globalThis.cancelIdleCallback = originalCancelIdleCallback;
        }
    });
});
