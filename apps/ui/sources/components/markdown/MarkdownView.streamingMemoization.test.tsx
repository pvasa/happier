import React from 'react';
import { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { renderScreen } from '@/dev/testkit';
import { installMarkdownCommonModuleMocks } from './markdownTestHelpers';

declare global {
    // eslint-disable-next-line no-var
    var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const captured = vi.hoisted(() => ({
    renderedSpanTexts: [] as string[],
}));

installMarkdownCommonModuleMocks();

vi.mock('./MermaidRenderer', () => ({
    MermaidRenderer: () => null,
}));

vi.mock('./MarkdownSpansView', () => ({
    MarkdownSpansView: (props: { spans: Array<{ text: string }> }) => {
        captured.renderedSpanTexts.push(props.spans.map((span) => span.text).join(''));
        return React.createElement('MarkdownSpansView', props);
    },
}));

describe('MarkdownView (streaming memoization)', () => {
    it('does not rerender an unchanged completed block when only a later streaming block changes', async () => {
        const { MarkdownView } = await import('./MarkdownView');

        const screen = await renderScreen(
            React.createElement(MarkdownView, {
                markdown: ['Stable block', 'Draft one'].join('\n'),
                streamingMode: 'streaming',
            }),
        );

        expect(captured.renderedSpanTexts).toEqual(['Stable block', 'Draft one']);
        captured.renderedSpanTexts.length = 0;

        await act(async () => {
            await screen.update(
                React.createElement(MarkdownView, {
                    markdown: ['Stable block', 'Draft one plus more'].join('\n'),
                    streamingMode: 'streaming',
                }),
            );
        });

        expect(captured.renderedSpanTexts).toEqual(['Draft one plus more']);
    }, 60_000);
});
