import * as React from 'react';

import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderScreen, standardCleanup } from '@/dev/testkit';
import { installSettingsViewCommonModuleMocks, resetSettingsViewCommonModuleMockState } from '../settingsViewTestHelpers';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const capture = vi.hoisted(() => ({
    items: [] as Array<Record<string, unknown>>,
    searchHeaders: [] as Array<Record<string, unknown>>,
    segmentedTabBars: [] as Array<Record<string, unknown>>,
    switches: [] as Array<Record<string, unknown>>,
    setRawSettings: vi.fn(),
    reset() {
        this.items = [];
        this.searchHeaders = [];
        this.segmentedTabBars = [];
        this.switches = [];
        this.setRawSettings.mockReset();
    },
}));

vi.mock('@/hooks/server/useFeatureEnabled', () => ({
    useFeatureEnabled: () => true,
}));

installSettingsViewCommonModuleMocks({
    storage: async (importOriginal) => {
        const { createStorageModuleMock } = await import('@/dev/testkit/mocks/storage');
        return createStorageModuleMock({
            importOriginal,
            overrides: {
                useSettingMutable: () => [{ v: 1, actions: {} }, capture.setRawSettings] as const,
                useSetting: () => ({ privacy: { shareDeviceInventory: true } }),
            },
        });
    },
});

vi.mock('@/components/ui/forms/SearchHeader', () => ({
    SearchHeader: (props: Record<string, unknown>) => {
        capture.searchHeaders.push(props);
        return null;
    },
}));

vi.mock('@/components/ui/forms/Switch', () => ({
    Switch: (props: Record<string, unknown>) => {
        capture.switches.push(props);
        return React.createElement('Switch', props);
    },
}));

vi.mock('@/components/ui/navigation/SegmentedTabBar', () => ({
    SegmentedTabBar: (props: Record<string, unknown>) => {
        capture.segmentedTabBars.push(props);
        return React.createElement('SegmentedTabBar', props);
    },
}));

vi.mock('@/components/ui/lists/Item', () => ({
    Item: (props: Record<string, unknown>) => {
        capture.items.push(props);
        return React.createElement(React.Fragment, null, props.rightElement as React.ReactNode);
    },
}));

vi.mock('@/components/ui/lists/ItemGroup', () => ({
    ItemGroup: ({ children }: { children?: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}));

vi.mock('@/components/ui/lists/ItemList', () => ({
    ItemList: ({ children }: { children?: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}));

vi.mock('@/components/ui/text/Text', () => ({
    Text: ({ children }: { children?: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}));

afterEach(() => {
    standardCleanup();
    capture.reset();
    resetSettingsViewCommonModuleMockState();
});

describe('ActionSettingsDetailView', () => {
    it('renders approval-capable targets as mode tabs and ordinary placements as switches', async () => {
        const { ActionSettingsDetailContent } = await import('./ActionSettingsDetailView');

        await renderScreen(<ActionSettingsDetailContent actionId="review.start" />);

        expect(capture.searchHeaders).toHaveLength(1);
        expect(capture.switches.some((switchProps) =>
            switchProps.testID === 'settings-actions:action:review.start:enabled',
        )).toBe(true);
        expect(capture.items.some((item) => item.testID === 'settings-actions:action:review.start:target:cli')).toBe(true);
        expect(capture.segmentedTabBars.some((bar) =>
            bar.testIDPrefix === 'settings-actions:action:review.start:target:cli:mode'
            && bar.activeTabId === 'allowed',
        )).toBe(true);
        expect(capture.switches.some((switchProps) =>
            switchProps.testID === 'settings-actions:action:review.start:target:command_palette:enabled',
        )).toBe(true);
    });

    it('persists ask-first approval mode through the canonical settings writer', async () => {
        const { ActionSettingsDetailContent } = await import('./ActionSettingsDetailView');

        await renderScreen(<ActionSettingsDetailContent actionId="review.start" />);

        const cliMode = capture.segmentedTabBars.find((bar) =>
            bar.testIDPrefix === 'settings-actions:action:review.start:target:cli:mode',
        );
        expect(cliMode).toBeTruthy();

        (cliMode?.onSelectTab as (tabId: string) => void)('ask_first');

        expect(capture.setRawSettings).toHaveBeenCalledWith({
            v: 1,
            actions: {
                'review.start': {
                    enabledPlacements: [],
                    disabledSurfaces: [],
                    disabledPlacements: [],
                    approvalRequiredSurfaces: ['cli'],
                },
            },
        });
    });
});
