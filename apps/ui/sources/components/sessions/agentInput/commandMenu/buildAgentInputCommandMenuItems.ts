import * as React from 'react';

import type { AutocompleteSuggestion } from '@/components/autocomplete/autocompleteTypes';
import type { CommandMenuItem } from '@/components/ui/commandMenu/commandMenuTypes';

/**
 * Maps the existing `AutocompleteSuggestion[]` pipeline into `CommandMenuItem[]`
 * that `<CommandMenu>` can render.
 *
     * When a suggestion has a `component` (file mentions, vendor plugins, skills),
     * we delegate to that component via `renderRow` so the visual appearance stays
     * the same as the pre-migration autocomplete rows.
 *
 * When a suggestion has only a `label` (slash commands), we use the primitive's
 * default row (icon + label + description).
 *
 * The original suggestion is preserved as `meta` so the host can retrieve it
 * in `onSelect` without maintaining a parallel lookup.
 */
export function buildAgentInputCommandMenuItems(
    suggestions: readonly AutocompleteSuggestion[],
): readonly CommandMenuItem[] {
    return suggestions.map((s): CommandMenuItem => {
        const hasComponent = typeof s.component === 'function';

        return {
            id: s.key,
            label: s.label ?? s.text,
            description: s.description,
            rowHeight: s.rowHeight,
            renderRow: hasComponent
                ? () => React.createElement(s.component!)
                : undefined,
            meta: s,
        };
    });
}
