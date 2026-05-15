import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';
import { installAgentInputCommonModuleMocks } from './agentInputTestHelpers';
import { settingsDefaults, type Settings } from '@/sync/domains/settings/settings';
import { createUseSettingMock } from '@/dev/testkit/mocks/storage';

vi.mock('expo-haptics', () => ({
    impactAsync: vi.fn(async () => {}),
    notificationAsync: vi.fn(async () => {}),
    ImpactFeedbackStyle: { Light: 'Light' },
    NotificationFeedbackType: { Error: 'Error' },
}));

const keyboardMockState = vi.hoisted(() => ({
    callCount: 0,
    height: 0,
}));

const layoutMockState = vi.hoisted(() => ({
    platform: 'ios' as 'ios' | 'web',
    width: 700,
    height: 800,
}));

const multiTextInputMockState = vi.hoisted(() => ({
    renderCount: 0,
}));

vi.mock('@/hooks/ui/useKeyboardHeight', () => ({
    useKeyboardHeight: () => {
        keyboardMockState.callCount += 1;
        return keyboardMockState.height;
    },
}));

vi.mock('@/components/ui/forms/MultiTextInput', () => ({
    MultiTextInput: (props: Record<string, unknown>) => {
        multiTextInputMockState.renderCount += 1;
        return React.createElement('MultiTextInput', props, null);
    },
}));

let storageSettings: Settings = {
    ...settingsDefaults,
    profiles: [],
    agentInputEnterToSend: true,
    agentInputActionBarLayout: 'auto',
    agentInputChipDensity: 'labels',
    sessionPermissionModeApplyTiming: 'immediate',
};

installAgentInputCommonModuleMocks({
    reactNative: async () => {
        const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
        return createReactNativeWebMock({
            View: (props: Record<string, unknown> & { children?: React.ReactNode }) =>
                React.createElement('View', props, props.children),
            Text: (props: Record<string, unknown> & { children?: React.ReactNode }) =>
                React.createElement('Text', props, props.children),
            Pressable: (props: Record<string, unknown> & { children?: React.ReactNode }) =>
                React.createElement('Pressable', props, props.children),
            ScrollView: (props: Record<string, unknown> & { children?: React.ReactNode }) =>
                React.createElement('ScrollView', props, props.children),
            Platform: {
                OS: layoutMockState.platform,
                select: (v: any) => v?.[layoutMockState.platform] ?? v?.default,
            },
            useWindowDimensions: () => ({ width: layoutMockState.width, height: layoutMockState.height }),
            Dimensions: {
                get: () => ({ width: layoutMockState.width, height: layoutMockState.height, scale: 1, fontScale: 1 }),
            },
            Keyboard: {
                addListener: () => ({ remove: () => {} }),
            },
        });
    },
    icons: async () => ({
        Ionicons: (props: Record<string, unknown>) => React.createElement('Ionicons', props, null),
        Octicons: (props: Record<string, unknown>) => React.createElement('Octicons', props, null),
    }),
    text: async () => {
        const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
        return createTextModuleMock();
    },
    storage: async (importOriginal) => {
        const { createStorageModuleMock } = await import('@/dev/testkit/mocks/storage');
        return createStorageModuleMock({
            importOriginal,
            overrides: {
                useSetting: createUseSettingMock({
                    fallback: (key) => storageSettings[key],
                }),
                useSettings: () => storageSettings,
                useSessionMessages: () => ({ messages: [], isLoaded: true }),
                useSessionTranscriptIds: () => ({ ids: [], isLoaded: true }),
                useSessionMessagesById: () => ({}),
                useSessionMessagesVersion: () => 0,
            },
        });
    },
    });

describe('AgentInput (action bar auto layout)', () => {
    beforeEach(() => {
        keyboardMockState.callCount = 0;
        keyboardMockState.height = 0;
        layoutMockState.platform = 'ios';
        layoutMockState.width = 700;
        layoutMockState.height = 800;
        storageSettings = {
            ...storageSettings,
            agentInputActionBarLayout: 'auto',
            agentInputChipDensity: 'labels',
        };
        multiTextInputMockState.renderCount = 0;
    });

    it('does not subscribe to passive keyboard height while rendering the native composer', async () => {
        layoutMockState.platform = 'ios';
        keyboardMockState.height = 320;
        vi.resetModules();
        const { AgentInput } = await import('./AgentInput');

        await renderScreen(
            <AgentInput
                value=""
                placeholder="Type"
                onChangeText={() => {}}
                onSend={() => {}}
                onPermissionClick={() => {}}
                onMachineClick={() => {}}
                machineName="Builder"
                onPathClick={() => {}}
                currentPath="/tmp"
                autocompletePrefixes={[]}
                autocompleteSuggestions={async () => []}
                maxPanelHeight={360}
            />,
        );

        expect(keyboardMockState.callCount).toBe(0);
    });

    it('uses the scrollable action bar layout in auto mode on sub-tablet widths', async () => {
        storageSettings = { ...storageSettings, agentInputChipDensity: 'labels' };
        vi.resetModules();
        const { AgentInput } = await import('./AgentInput');

        const screen = await renderScreen(
            <AgentInput
                value=""
                placeholder="Type"
                onChangeText={() => {}}
                onSend={() => {}}
                onPermissionClick={() => {}}
                onMachineClick={() => {}}
                machineName="Builder"
                onPathClick={() => {}}
                currentPath="/tmp"
                autocompletePrefixes={[]}
                autocompleteSuggestions={async () => []}
            />,
        );

        const scrollViews = screen.tree.root.findAll((node: any) => (
            node?.type === 'ScrollView' && node?.props?.horizontal === true
        ));
        expect(scrollViews.length).toBeGreaterThan(0);
        expect(scrollViews[0]?.props?.scrollEnabled).toBe(true);
    });

    it('keeps mobile action controls in two visible scrollable chip rows without the keyboard', async () => {
        keyboardMockState.height = 0;
        vi.resetModules();
        const { AgentInput } = await import('./AgentInput');

        const screen = await renderScreen(
            <AgentInput
                value=""
                placeholder="Type"
                onChangeText={() => {}}
                onSend={() => {}}
                onPermissionClick={() => {}}
                onMachineClick={() => {}}
                machineName="Builder"
                onPathClick={() => {}}
                currentPath="/tmp"
                autocompletePrefixes={[]}
                autocompleteSuggestions={async () => []}
            />,
        );

        const verticalScrollViews = screen.tree.root.findAll((node: any) => (
            node?.type === 'ScrollView' && node?.props?.horizontal !== true
        ));
        expect(verticalScrollViews.length).toBeGreaterThan(0);

        const horizontalScrollViews = screen.tree.root.findAll((node: any) => (
            node?.type === 'ScrollView' && node?.props?.horizontal === true
        ));
        expect(horizontalScrollViews).toHaveLength(2);

        let secondScrollWrapper: any = horizontalScrollViews[1]?.parent ?? null;
        while (secondScrollWrapper && secondScrollWrapper.type !== 'View') {
            secondScrollWrapper = secondScrollWrapper.parent;
        }
        const secondScrollWrapperStyle = Array.isArray(secondScrollWrapper?.props?.style)
            ? secondScrollWrapper?.props?.style
            : [secondScrollWrapper?.props?.style];
        expect(secondScrollWrapperStyle).toEqual(expect.arrayContaining([
            expect.objectContaining({
                minHeight: expect.any(Number),
            }),
        ]));
    });

    it('keeps the path chip label visible even when chip density is icons', async () => {
        storageSettings = { ...storageSettings, agentInputChipDensity: 'icons' };
        vi.resetModules();
        const { AgentInput } = await import('./AgentInput');

        const screen = await renderScreen(
            <AgentInput
                value=""
                placeholder="Type"
                onChangeText={() => {}}
                onSend={() => {}}
                onPermissionClick={() => {}}
                onMachineClick={() => {}}
                machineName="Builder"
                onPathClick={() => {}}
                currentPath="/tmp/my-repo"
                autocompletePrefixes={[]}
                autocompleteSuggestions={async () => []}
            />,
        );

        const pathChip = screen.tree.root.findByProps({ testID: 'agent-input-path-chip' });
        const textNodes = pathChip.findAll((node: any) => node?.type === 'Text');
        expect(textNodes.length).toBeGreaterThan(0);
        storageSettings = { ...storageSettings, agentInputChipDensity: 'labels' };
    });

    it('ignores fractional duplicate layout measurements that resolve to the same pixel', async () => {
        keyboardMockState.height = 320;
        vi.resetModules();
        const { act } = await import('react-test-renderer');
        const { AgentInput } = await import('./AgentInput');

        const screen = await renderScreen(
            <AgentInput
                value=""
                placeholder="Type"
                onChangeText={() => {}}
                onSend={() => {}}
                onPermissionClick={() => {}}
                onMachineClick={() => {}}
                machineName="Builder"
                onPathClick={() => {}}
                currentPath="/tmp"
                autocompletePrefixes={[]}
                autocompleteSuggestions={async () => []}
            />,
        );

        const panel = screen.tree.root.findByProps({ testID: 'agent-input-drop-zone' });
        const input = screen.tree.root.findByType('MultiTextInput');
        const inputContainer = input.parent;

        await act(async () => {
            panel.props.onLayout({ nativeEvent: { layout: { height: 170.2 } } });
            inputContainer?.props.onLayout({ nativeEvent: { layout: { height: 60.2 } } });
            input.props.onLayout({ nativeEvent: { layout: { height: 52.2 } } });
        });

        const renderCountAfterInitialMeasurements = multiTextInputMockState.renderCount;

        await act(async () => {
            panel.props.onLayout({ nativeEvent: { layout: { height: 170.8 } } });
            inputContainer?.props.onLayout({ nativeEvent: { layout: { height: 60.8 } } });
            input.props.onLayout({ nativeEvent: { layout: { height: 52.8 } } });
        });

        expect(multiTextInputMockState.renderCount).toBe(renderCountAfterInitialMeasurements);
    });
});
