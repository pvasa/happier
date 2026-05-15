import * as React from 'react';
import { act } from 'react-test-renderer';
import { describe, expect, it } from 'vitest';

import {
    ComposerKeyboardProvider,
    ComposerKeyboardScrollInset,
} from '@/components/sessions/keyboardAvoidance';
import {
    createMockComposerKeyboardLayout,
    renderScreen,
} from '@/dev/testkit';
import type { ComposerKeyboardLayout } from './ComposerKeyboardContext';

describe('ComposerKeyboardScrollInset', () => {
    it('uses subscribed list inset updates so native lists reserve composer space', async () => {
        const listeners = new Set<(height: number) => void>();
        const layout = {
            ...createMockComposerKeyboardLayout({ listBottomInset: 0 }),
            subscribeListBottomInset: (listener: (height: number) => void) => {
                listeners.add(listener);
                listener(0);
                return () => {
                    listeners.delete(listener);
                };
            },
        } satisfies ComposerKeyboardLayout;

        const screen = await renderScreen(
            <ComposerKeyboardProvider layout={layout}>
                <ComposerKeyboardScrollInset testID="transcript-composer-keyboard-inset" />
            </ComposerKeyboardProvider>,
        );

        const readHeight = () => {
            const node = screen.getByTestId('transcript-composer-keyboard-inset');
            const styles = Array.isArray(node.props.style) ? node.props.style : [node.props.style];
            return styles.reduce<number | undefined>((height, style) => (
                typeof style?.height === 'number' ? style.height : height
            ), undefined);
        };

        expect(readHeight()).toBe(0);

        await act(async () => {
            for (const listener of listeners) {
                listener(192);
            }
        });

        expect(readHeight()).toBe(192);
    });
});
