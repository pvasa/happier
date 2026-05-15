import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createMockComposerKeyboardLayout, renderHook, standardCleanup } from '@/dev/testkit';
import {
    ComposerKeyboardProvider,
    useComposerAvailablePanelHeight,
} from '@/components/sessions/keyboardAvoidance';
import type { ComposerKeyboardLayout } from './ComposerKeyboardContext';

describe('useComposerAvailablePanelHeight', () => {
    afterEach(() => {
        vi.useRealTimers();
        standardCleanup();
    });

    it('uses subscription updates instead of reading the shared value during render', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(1_000);
        const listeners = new Set<(height: number) => void>();
        let unsubscribeCount = 0;
        const layout = {
            ...createMockComposerKeyboardLayout({ availablePanelHeight: 640 }),
            subscribeAvailablePanelHeight: (listener: (height: number) => void) => {
                listeners.add(listener);
                return () => {
                    unsubscribeCount += 1;
                    listeners.delete(listener);
                };
            },
        } satisfies ComposerKeyboardLayout;

        const wrapper = ({ children }: React.PropsWithChildren) => (
            <ComposerKeyboardProvider layout={layout}>
                {children}
            </ComposerKeyboardProvider>
        );

        const hook = await renderHook(() => useComposerAvailablePanelHeight(), { wrapper });

        expect(hook.getCurrent()).toBeUndefined();

        act(() => {
            for (const listener of listeners) {
                listener(512);
            }
        });

        expect(hook.getCurrent()).toBe(512);

        await hook.unmount();

        expect(unsubscribeCount).toBe(1);
        expect(listeners.size).toBe(0);
    });
});
