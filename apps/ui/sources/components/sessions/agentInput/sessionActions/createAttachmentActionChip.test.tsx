import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createReactNativeWebMock, renderScreen } from '@/dev/testkit';
import type { ActionListItem } from '@/components/ui/lists/ActionListSection';

vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock({ translate: (key) => key });
});

vi.mock('@expo/vector-icons', () => ({
    Ionicons: (props: Record<string, unknown>) => React.createElement('Ionicons', props),
}));

function assertSingleCollapsedAction(
    action: ActionListItem | readonly ActionListItem[] | undefined,
): asserts action is ActionListItem {
    expect(Array.isArray(action)).toBe(false);
    if (!action || Array.isArray(action)) {
        throw new Error('expected a single collapsed action');
    }
}

afterEach(() => {
    vi.resetModules();
});

describe('createAttachmentActionChip', () => {
    it('on iOS it uses the shared simple chooser popover', async () => {
        vi.doMock('react-native', async () => createReactNativeWebMock({
            Platform: { OS: 'ios' },
        }));

        const { createAttachmentActionChip } = await import('./createAttachmentActionChip');
        const onPickFile = vi.fn();
        const onPickImage = vi.fn();

        const chip = createAttachmentActionChip({
            onPickFile,
            onPickImage,
        } as any);

        expect(chip.collapsedContentPopover).toBeFalsy();
        expect(chip.collapsedOptionsPopover).toMatchObject({
            presentation: 'simple',
            title: null,
            closeOnSelect: false,
            options: [
                { id: 'add-image', label: 'common.addImage' },
                { id: 'add-file', label: 'common.addFile' },
            ],
        });

        chip.collapsedOptionsPopover?.onSelect?.('add-image');
        expect(onPickImage).toHaveBeenCalledTimes(1);

        chip.collapsedOptionsPopover?.onSelect?.('add-file');
        expect(onPickFile).toHaveBeenCalledTimes(1);

        const toggleCollapsedPopover = vi.fn();
        const screen = await renderScreen(
            <React.Fragment>
                {chip.render({
                    chipStyle: () => ({}),
                    showLabel: true,
                    iconColor: '#000',
                    textStyle: {},
                    countTextStyle: {},
                    chipAnchorRef: { current: null },
                    popoverAnchorRef: { current: null },
                    toggleCollapsedPopover,
                })}
            </React.Fragment>,
        );

        expect(screen.tree.toJSON()).not.toBeNull();
        await screen.pressByTestIdAsync('agent-input-attachments-chip');
        expect(toggleCollapsedPopover).toHaveBeenCalledWith('attachments-add');
    });

    it('on Android it also uses the shared simple chooser popover', async () => {
        vi.doMock('react-native', async () => createReactNativeWebMock({
            Platform: { OS: 'android' },
        }));

        const { createAttachmentActionChip } = await import('./createAttachmentActionChip');
        const onPickFile = vi.fn();
        const onPickImage = vi.fn();

        const chip = createAttachmentActionChip({
            onPickFile,
            onPickImage,
        } as any);

        expect(chip.collapsedContentPopover).toBeFalsy();
        expect(chip.collapsedOptionsPopover).toMatchObject({
            presentation: 'simple',
            title: null,
            closeOnSelect: false,
            options: [
                { id: 'add-image', label: 'common.addImage' },
                { id: 'add-file', label: 'common.addFile' },
            ],
        });

        chip.collapsedOptionsPopover?.onSelect?.('add-image');
        expect(onPickImage).toHaveBeenCalledTimes(1);

        chip.collapsedOptionsPopover?.onSelect?.('add-file');
        expect(onPickFile).toHaveBeenCalledTimes(1);

        const toggleCollapsedPopover = vi.fn();
        const screen = await renderScreen(
            <React.Fragment>
                {chip.render({
                    chipStyle: () => ({}),
                    showLabel: true,
                    iconColor: '#000',
                    textStyle: {},
                    countTextStyle: {},
                    chipAnchorRef: { current: null },
                    popoverAnchorRef: { current: null },
                    toggleCollapsedPopover,
                })}
            </React.Fragment>,
        );

        expect(screen.tree.toJSON()).not.toBeNull();
        await screen.pressByTestIdAsync('agent-input-attachments-chip');
        expect(toggleCollapsedPopover).toHaveBeenCalledWith('attachments-add');
    });

    it('on web it keeps the attach chip as a direct action (no chooser popover)', async () => {
        vi.doMock('react-native', async () => createReactNativeWebMock({
            Platform: { OS: 'web' },
        }));

        const { createAttachmentActionChip } = await import('./createAttachmentActionChip');
        const callOrder: string[] = [];
        const onPickFile = vi.fn(() => {
            callOrder.push('pickFile');
        });
        const onPickImage = vi.fn();
        const chip = createAttachmentActionChip({
            onPickFile,
            onPickImage,
        } as any);

        expect(chip.collapsedContentPopover).toBeFalsy();
        expect(typeof chip.collapsedAction).toBe('function');

        const dismiss = vi.fn(() => {
            callOrder.push('dismiss');
        });
        const blurInput = vi.fn(() => {
            callOrder.push('blur');
        });
        const collapsed = chip.collapsedAction?.({
            tint: '#000',
            dismiss,
            blurInput,
        });
        assertSingleCollapsedAction(collapsed);
        if (typeof collapsed.onPress !== 'function') {
            throw new Error('Expected web attach chip to expose a single collapsedAction with onPress');
        }

        collapsed.onPress();
        expect(callOrder).toEqual(['blur', 'pickFile', 'dismiss']);

        const screen = await renderScreen(
            <React.Fragment>
                {chip.render({
                    chipStyle: () => ({}),
                    showLabel: true,
                    iconColor: '#000',
                    textStyle: {},
                    countTextStyle: {},
                    chipAnchorRef: { current: null },
                    popoverAnchorRef: { current: null },
                    toggleCollapsedPopover: vi.fn(),
                })}
            </React.Fragment>,
        );
        expect(screen.tree.toJSON()).not.toBeNull();
        await screen.pressByTestIdAsync('agent-input-attachments-chip');
        expect(onPickFile).toHaveBeenCalled();
    });

    it('on web it ignores duplicate press events fired shortly after opening (prevents double-open)', async () => {
        vi.doMock('react-native', async () => createReactNativeWebMock({
            Platform: { OS: 'web' },
        }));

        const { createAttachmentActionChip } = await import('./createAttachmentActionChip');
        const originalNow = Date.now;

        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-03-25T12:00:00.000Z'));

        try {
            const onPickFile = vi.fn();
            const onPickImage = vi.fn();
            const chip = createAttachmentActionChip({
                onPickFile,
                onPickImage,
            } as any);

            const screen = await renderScreen(
                <React.Fragment>
                    {chip.render({
                        chipStyle: () => ({}),
                        showLabel: true,
                        iconColor: '#000',
                        textStyle: {},
                        countTextStyle: {},
                        chipAnchorRef: { current: null },
                        popoverAnchorRef: { current: null },
                        toggleCollapsedPopover: vi.fn(),
                    })}
                </React.Fragment>,
            );

            await screen.pressByTestIdAsync('agent-input-attachments-chip');
            await screen.pressByTestIdAsync('agent-input-attachments-chip');
            expect(onPickFile).toHaveBeenCalledTimes(1);

            vi.advanceTimersByTime(500);
            await screen.pressByTestIdAsync('agent-input-attachments-chip');
            expect(onPickFile).toHaveBeenCalledTimes(2);
        } finally {
            vi.useRealTimers();
            (Date as any).now = originalNow;
        }
    });

});
