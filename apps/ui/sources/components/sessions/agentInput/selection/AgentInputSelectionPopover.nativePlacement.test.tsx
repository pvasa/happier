import * as React from 'react';
import { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderScreen } from '@/dev/testkit';
import { createMockComposerKeyboardLayout } from '@/dev/testkit/mocks/keyboardAvoidance';
import { ComposerKeyboardProvider } from '@/components/sessions/keyboardAvoidance/ComposerKeyboardContext';

let mockKeyboardHeight = 0;

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock({
        Platform: {
            OS: 'ios',
            select: (value: any) => value.ios ?? value.default ?? null,
        },
    });
});

vi.mock('@/hooks/ui/useKeyboardHeight', () => ({
    useKeyboardHeight: () => mockKeyboardHeight,
}));

type CapturedPopoverProps = Record<string, unknown> & {
    keyboardBottomInset?: number;
    placement?: string;
};
const capturedPopoverProps: { current: CapturedPopoverProps | null } = { current: null };

vi.mock('@/components/ui/popover', () => ({
    Popover: (props: CapturedPopoverProps) => {
        capturedPopoverProps.current = props;
        const renderedChildren = typeof (props as any).children === 'function'
            ? (props as any).children({ maxHeight: 312 })
            : (props as any).children ?? null;
        return React.createElement('Popover', props, renderedChildren);
    },
    PopoverScope: ({ children }: any) => React.createElement(React.Fragment, null, children),
}));

describe('AgentInputSelectionPopover (native placement)', () => {
    beforeEach(() => {
        mockKeyboardHeight = 0;
        capturedPopoverProps.current = null;
    });

    it('uses placement=top when the keyboard is not visible', async () => {
        const { AgentInputSelectionPopover } = await import('./AgentInputSelectionPopover');
        const anchorRef = { current: { nodeType: 'View' } } as any;

        await renderScreen(
            <AgentInputSelectionPopover open anchorRef={anchorRef} onRequestClose={() => {}}>
                {() => <React.Fragment />}
            </AgentInputSelectionPopover>,
        );

        expect(capturedPopoverProps.current?.placement).toBe('top');
    });

    it('uses keyboard-safe auto-vertical placement when the keyboard is visible', async () => {
        mockKeyboardHeight = 320;
        const { AgentInputSelectionPopover } = await import('./AgentInputSelectionPopover');
        const anchorRef = { current: { nodeType: 'View' } } as any;

        await renderScreen(
            <AgentInputSelectionPopover open anchorRef={anchorRef} onRequestClose={() => {}}>
                {() => <React.Fragment />}
            </AgentInputSelectionPopover>,
        );

        expect(capturedPopoverProps.current?.placement).toBe('auto-vertical');
        expect(capturedPopoverProps.current?.keyboardBottomInset).toBe(320);
    });

    it('retains the composer keyboard lift while open inside a composer scaffold', async () => {
        mockKeyboardHeight = 320;
        const release = vi.fn();
        const retainKeyboardLift = vi.fn(() => release);
        const layout = {
            ...createMockComposerKeyboardLayout({ keyboardHeightLive: 320 }),
            retainKeyboardLift,
        };
        const { AgentInputSelectionPopover } = await import('./AgentInputSelectionPopover');
        const anchorRef = { current: { nodeType: 'View' } } as any;

        const screen = await renderScreen(
            <ComposerKeyboardProvider layout={layout}>
                <AgentInputSelectionPopover open anchorRef={anchorRef} onRequestClose={() => {}}>
                    {() => <React.Fragment />}
                </AgentInputSelectionPopover>
            </ComposerKeyboardProvider>,
        );

        expect(retainKeyboardLift).toHaveBeenCalledTimes(1);

        act(() => {
            screen.tree.unmount();
        });

        expect(release).toHaveBeenCalledTimes(1);
    });

    it('does not release the retained composer lift when passive keyboard height drops while open', async () => {
        mockKeyboardHeight = 320;
        const release = vi.fn();
        const retainKeyboardLift = vi.fn(() => release);
        const layout = {
            ...createMockComposerKeyboardLayout({
                keyboardHeightForInset: 320,
                keyboardHeightLive: 320,
            }),
            retainKeyboardLift,
        };
        const { AgentInputSelectionPopover } = await import('./AgentInputSelectionPopover');
        const anchorRef = { current: { nodeType: 'View' } } as any;

        const renderPopover = () => (
            <ComposerKeyboardProvider layout={layout}>
                <AgentInputSelectionPopover open anchorRef={anchorRef} onRequestClose={() => {}}>
                    {() => <React.Fragment />}
                </AgentInputSelectionPopover>
            </ComposerKeyboardProvider>
        );
        const screen = await renderScreen(renderPopover());

        expect(retainKeyboardLift).toHaveBeenCalledTimes(1);

        mockKeyboardHeight = 0;
        await screen.update(renderPopover());

        expect(retainKeyboardLift).toHaveBeenCalledTimes(1);
        expect(release).not.toHaveBeenCalled();
    });
});
