import * as React from 'react';
import { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderSettingsView } from '@/dev/testkit/harness/settingsViewHarness';
import { createStorageModuleMock } from '@/dev/testkit/mocks/storage';

import {
    installSessionSettingsCommonModuleMocks,
} from './sessionSettingsViewTestHelpers';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const settingsState = vi.hoisted(() => ({
    values: {
        sessionReplayEnabled: true,
        sessionReplayStrategy: 'summary_plus_recent',
        sessionReplayRecentMessagesCount: 100,
        sessionReplayMaxSeedChars: 50_000,
        sessionReplaySummaryRunnerV1: null,
    } as Record<string, unknown>,
}));

vi.mock('@expo/vector-icons', () => ({
    Ionicons: 'Ionicons',
}));

installSessionSettingsCommonModuleMocks({
    storage: async (importOriginal) => createStorageModuleMock({
        importOriginal,
        overrides: {
            useSettingMutable: ((key: string) => {
                const [value, setValue] = React.useState(() => settingsState.values[key] ?? null);

                return [
                    value,
                    (next: unknown) => {
                        setValue((current) => {
                            const resolved = typeof next === 'function'
                                ? (next as (value: unknown) => unknown)(current)
                                : next;
                            settingsState.values[key] = resolved;
                            return resolved;
                        });
                    },
                ] as const;
            }) as unknown as typeof import('@/sync/domains/state/storage')['useSettingMutable'],
        },
    }),
});

vi.mock('expo-router', () => ({
    useRouter: () => ({
        push: vi.fn(),
    }),
}));

vi.mock('@/hooks/server/useFeatureEnabled', () => ({
    useFeatureEnabled: () => true,
}));

vi.mock('@/components/ui/lists/ItemList', () => ({
    ItemList: React.forwardRef((props: any, _ref) => React.createElement('ItemList', props, props.children)),
}));

vi.mock('@/components/ui/lists/ItemGroup', () => ({
    ItemGroup: (props: any) => React.createElement('ItemGroup', props, props.children),
}));

vi.mock('@/components/ui/lists/Item', () => ({
    Item: (props: any) => React.createElement('Item', props, props.rightElement ?? null, props.children ?? null),
}));

vi.mock('@/components/ui/forms/Switch', () => ({
    Switch: (props: any) => React.createElement('Switch', props),
}));

vi.mock('@/components/ui/forms/dropdown/DropdownMenu', () => ({
    DropdownMenu: (props: any) => React.createElement('DropdownMenu', props),
}));

vi.mock('@/components/ui/text/Text', () => ({
    Text: 'Text',
    TextInput: (props: any) => React.createElement('TextInput', props),
}));

vi.mock('@/components/settings/llmTasks/LlmTaskRunnerConfigV1BackendModelPicker', () => ({
    LlmTaskRunnerConfigV1BackendModelPicker: (props: any) =>
        React.createElement('LlmTaskRunnerConfigV1BackendModelPicker', props),
}));

describe('SessionResumeSettingsView', () => {
    beforeEach(() => {
        settingsState.values = {
            sessionReplayEnabled: true,
            sessionReplayStrategy: 'summary_plus_recent',
            sessionReplayRecentMessagesCount: 100,
            sessionReplayMaxSeedChars: 50_000,
            sessionReplaySummaryRunnerV1: null,
        };
    });

    it('keeps the raw max seed chars draft while typing and clamps when the field is committed', async () => {
        const mod = await import('./SessionResumeSettingsView');
        const SessionResumeSettingsView = mod.default;
        const screen = await renderSettingsView(React.createElement(SessionResumeSettingsView));
        const input = screen.findByTestId('settings-session-replay-maxSeedChars-input')!;

        act(() => {
            screen.changeTextByTestId('settings-session-replay-maxSeedChars-input', '3');
        });

        expect(input.props.value).toBe('3');
        expect(settingsState.values.sessionReplayMaxSeedChars).toBe(50_000);

        act(() => {
            input.props.onBlur?.();
        });

        expect(settingsState.values.sessionReplayMaxSeedChars).toBe(500);
        expect(input.props.value).toBe('500');
    });
});
