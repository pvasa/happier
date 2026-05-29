import { describe, expect, it } from 'vitest';

import type { AutocompleteSuggestion } from '@/components/autocomplete/autocompleteTypes';
import { buildAgentInputCommandMenuItems } from '../buildAgentInputCommandMenuItems';

describe('buildAgentInputCommandMenuItems', () => {
    it('maps a label-based suggestion to a CommandMenuItem with id, label, description, and rowHeight', () => {
        const suggestions: readonly AutocompleteSuggestion[] = [
            { key: 'cmd-goal', text: '/goal', label: 'goal', description: 'Set a goal', rowHeight: 52 },
        ];

        const items = buildAgentInputCommandMenuItems(suggestions);

        expect(items).toHaveLength(1);
        expect(items[0]).toEqual(expect.objectContaining({
            id: 'cmd-goal',
            label: 'goal',
            description: 'Set a goal',
            rowHeight: 52,
            meta: suggestions[0],
        }));
    });

    it('maps a suggestion without description to a CommandMenuItem with undefined description', () => {
        const suggestions: readonly AutocompleteSuggestion[] = [
            { key: 'cmd-help', text: '/help', label: 'help' },
        ];

        const items = buildAgentInputCommandMenuItems(suggestions);

        expect(items).toHaveLength(1);
        expect(items[0]!.description).toBeUndefined();
    });

    it('maps multiple suggestions preserving order', () => {
        const suggestions: readonly AutocompleteSuggestion[] = [
            { key: 'a', text: '/a', label: 'Alpha' },
            { key: 'b', text: '/b', label: 'Beta' },
            { key: 'c', text: '/c', label: 'Charlie' },
        ];

        const items = buildAgentInputCommandMenuItems(suggestions);

        expect(items.map((i) => i.id)).toEqual(['a', 'b', 'c']);
    });

    it('returns an empty array for empty suggestions', () => {
        const items = buildAgentInputCommandMenuItems([]);
        expect(items).toEqual([]);
    });

    it('provides a renderRow function for component-based suggestions', () => {
        const MockComponent = (() => null) as React.ElementType;
        const suggestions: readonly AutocompleteSuggestion[] = [
            { key: 'file-1', text: '@file.ts', component: MockComponent, rowHeight: 40 },
        ];

        const items = buildAgentInputCommandMenuItems(suggestions);

        expect(items).toHaveLength(1);
        expect(items[0]!.renderRow).toBeDefined();
        expect(typeof items[0]!.renderRow).toBe('function');
    });

    it('uses suggestion.text as the label when suggestion.label is undefined and component is present', () => {
        const suggestions: readonly AutocompleteSuggestion[] = [
            { key: 'file-2', text: '@something.ts', component: (() => null) as React.ElementType },
        ];

        const items = buildAgentInputCommandMenuItems(suggestions);

        expect(items[0]!.label).toBe('@something.ts');
    });

    it('preserves the original suggestion as meta for host-side retrieval', () => {
        const suggestion: AutocompleteSuggestion = {
            key: 'my-key',
            text: '/test',
            label: 'test',
            description: 'desc',
        };

        const items = buildAgentInputCommandMenuItems([suggestion]);

        expect(items[0]!.meta).toBe(suggestion);
    });
});
