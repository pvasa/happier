import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';

vi.mock('@/components/ui/text/Text', () => ({
    Text: 'Text',
}));

describe('InlineRepoPathLabel', () => {
    it('splits a nested repo path into an ellipsized directory label and filename label', async () => {
        const { InlineRepoPathLabel } = await import('./InlineRepoPathLabel');

        const screen = await renderScreen(
            <InlineRepoPathLabel
                fullPath="src/middleware/rateLimit.ts"
                pathTextStyle={{ color: 'path' }}
                nameTextStyle={{ color: 'name' }}
                nameMaxWidth="70%"
            />,
        );

        const labels = screen.tree.root.findAllByType('Text' as never);
        expect(labels).toHaveLength(2);
        expect(labels[0]!.props.children).toBe('src/middleware/');
        expect(labels[0]!.props.ellipsizeMode).toBe('head');
        expect(labels[1]!.props.children).toBe('rateLimit.ts');
        expect(labels[1]!.props.ellipsizeMode).toBe('middle');
    });

    it('keeps root-level filenames aligned with nested filenames by default', async () => {
        const { InlineRepoPathLabel } = await import('./InlineRepoPathLabel');

        const screen = await renderScreen(
            <InlineRepoPathLabel fullPath="README.md" />,
        );

        const labels = screen.tree.root.findAllByType('Text' as never);
        const spacers = screen.tree.root.findAllByType('View' as never).filter((node) => {
            const style = node.props.style;
            return style?.flex === 1 && style?.minWidth === 0;
        });

        expect(labels).toHaveLength(1);
        expect(labels[0]!.props.children).toBe('README.md');
        expect(spacers).toHaveLength(1);
    });
});
