import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';

vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();
    return {
        ...actual,
        Pressable: (props: Record<string, unknown> & { children?: React.ReactNode }) =>
            React.createElement('Pressable', props, props.children),
    };
});

vi.mock('@expo/vector-icons', () => ({
    Ionicons: (props: Record<string, unknown>) => React.createElement('Ionicons', props),
}));

vi.mock('@/components/ui/lists/Item', () => ({
    Item: (props: Record<string, unknown>) => React.createElement('Item', props),
}));

vi.mock('@/components/ui/lists/ItemGroup', () => ({
    ItemGroup: (props: Record<string, unknown> & { children?: React.ReactNode }) =>
        React.createElement('ItemGroup', props, props.children),
}));

vi.mock('@/components/ui/forms/dropdown/DropdownMenu', () => ({
    DropdownMenu: (props: Record<string, unknown>) => React.createElement('DropdownMenu', props),
}));

vi.mock('@/components/ui/rendering/normalizeNodeForView', () => ({
    normalizeNodeForView: (node: React.ReactNode) => node,
}));

const codexEntry = {
    targetKey: 'agent:codex',
    title: 'Codex',
    providerAgentId: 'codex',
    builtInAgentId: 'codex',
    target: { kind: 'builtInAgent', agentId: 'codex' },
};

describe('NewSessionModelSelectionContent', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders favorite models first and does not duplicate them in all models', async () => {
        const { NewSessionModelSelectionContent } = await import('./NewSessionModelSelectionContent');

        const screen = await renderScreen(
            <NewSessionModelSelectionContent
                modelOptions={[
                    { value: 'default', label: 'Default', description: 'Use CLI settings' },
                    { value: 'gpt-5.4', label: 'GPT-5.4', description: 'Fast' },
                    { value: 'gpt-5.5', label: 'GPT-5.5', description: 'Deep' },
                ]}
                selectedModelId="gpt-5.4"
                selectedIndicatorColor="#0af"
                selectedBackendEntry={codexEntry as any}
                favoriteModelSelections={[
                    {
                        v: 1,
                        backendTargetKey: 'agent:codex',
                        providerAgentId: 'codex',
                        builtInAgentId: 'codex',
                        configuredBackendId: null,
                        modelId: 'gpt-5.5',
                        modelLabel: 'GPT-5.5',
                        backendLabel: 'Codex',
                        addedAtMs: 1,
                    },
                ]}
                onSelectModel={vi.fn()}
                onFavoriteModelSelectionsChange={vi.fn()}
            />,
        );

        const groups = screen.findAllByType('ItemGroup' as any);
        expect(groups.map((group) => group.props.title)).toEqual(['Favorites', 'All']);

        const items = screen.findAllByType('Item' as any);
        expect(items.filter((item) => item.props.testID === 'new-session-model:gpt-5.5')).toHaveLength(1);
        expect(items.filter((item) => item.props.testID === 'new-session-model:gpt-5.4')).toHaveLength(1);
    });

    it('keeps stale favorite models removable without making them selectable', async () => {
        const onFavoriteModelSelectionsChange = vi.fn();
        const { NewSessionModelSelectionContent } = await import('./NewSessionModelSelectionContent');

        const screen = await renderScreen(
            <NewSessionModelSelectionContent
                modelOptions={[
                    { value: 'default', label: 'Default', description: 'Use CLI settings' },
                ]}
                selectedModelId="default"
                selectedIndicatorColor="#0af"
                selectedBackendEntry={codexEntry as any}
                favoriteModelSelections={[
                    {
                        v: 1,
                        backendTargetKey: 'agent:codex',
                        providerAgentId: 'codex',
                        builtInAgentId: 'codex',
                        configuredBackendId: null,
                        modelId: 'retired-model',
                        modelLabel: 'Retired model',
                        backendLabel: 'Codex',
                        addedAtMs: 1,
                    },
                ]}
                onSelectModel={vi.fn()}
                onFavoriteModelSelectionsChange={onFavoriteModelSelectionsChange}
            />,
        );

        const staleRows = screen.findAllByType('Item' as any).filter((item) => item.props.testID === 'new-session-model:retired-model');
        expect(staleRows).toHaveLength(1);
        expect(staleRows[0]?.props.disabled).toBe(true);

        const rightElement = staleRows[0]?.props.rightElement;
        expect(typeof rightElement?.props?.onToggleFavorite).toBe('function');
        rightElement?.props?.onToggleFavorite();

        expect(onFavoriteModelSelectionsChange).toHaveBeenCalledWith([]);
    });

    it('keeps favorite models grouped first in compact dropdown mode', async () => {
        const { NewSessionModelSelectionContent } = await import('./NewSessionModelSelectionContent');

        const screen = await renderScreen(
            <NewSessionModelSelectionContent
                presentation="compact"
                modelOptions={[
                    { value: 'gpt-5.4', label: 'GPT-5.4', description: 'Fast' },
                    { value: 'gpt-5.5', label: 'GPT-5.5', description: 'Deep' },
                ]}
                selectedModelId="gpt-5.4"
                selectedIndicatorColor="#0af"
                selectedBackendEntry={codexEntry as any}
                favoriteModelSelections={[
                    {
                        v: 1,
                        backendTargetKey: 'agent:codex',
                        providerAgentId: 'codex',
                        builtInAgentId: 'codex',
                        configuredBackendId: null,
                        modelId: 'gpt-5.5',
                        modelLabel: 'GPT-5.5',
                        backendLabel: 'Codex',
                        addedAtMs: 1,
                    },
                ]}
                onSelectModel={vi.fn()}
                onFavoriteModelSelectionsChange={vi.fn()}
            />,
        );

        const menu = screen.root.findByType('DropdownMenu' as any);
        expect(menu.props.items.map((item: any) => [item.id, item.category])).toEqual([
            ['gpt-5.5', 'Favorites'],
            ['gpt-5.4', 'All'],
        ]);
        expect(menu.props.search).toBe(true);
    });
});
