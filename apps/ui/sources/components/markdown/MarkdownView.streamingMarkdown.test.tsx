import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderScreen } from '@/dev/testkit';
import { installMarkdownCommonModuleMocks } from './markdownTestHelpers';

declare global {
    // eslint-disable-next-line no-var
    var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

installMarkdownCommonModuleMocks();

vi.mock('./MarkdownCodeBlock', () => ({
    MarkdownCodeBlock: (props: Record<string, unknown>) =>
        React.createElement('MarkdownCodeBlock', props),
}));

vi.mock('./MermaidRenderer', () => ({
    MermaidRenderer: (props: Record<string, unknown>) =>
        React.createElement('MermaidRenderer', props),
}));

function textNodes(screen: Awaited<ReturnType<typeof renderScreen>>) {
    return screen
        .findAll((node) => typeof node.props?.children === 'string')
        .map((node) => String(node.props.children));
}

function visibleText(screen: Awaited<ReturnType<typeof renderScreen>>) {
    return textNodes(screen).join('');
}

async function renderStreamingMarkdown(markdown: string, props: Record<string, unknown> = {}) {
    const { MarkdownView } = await import('./MarkdownView');
    return renderScreen(
        React.createElement(MarkdownView, {
            markdown,
            streamingMode: 'streaming',
            ...props,
        }),
    );
}

describe('MarkdownView (streaming markdown)', () => {
    it('repairs incomplete links as text while streaming', async () => {
        const screen = await renderStreamingMarkdown('Look at [docs](https://exa');

        expect(visibleText(screen)).toContain('Look at docs');
        expect(visibleText(screen)).not.toContain('(https://exa');
    }, 60_000);

    it('repairs incomplete bold spans while streaming', async () => {
        const screen = await renderStreamingMarkdown('This is **half');

        const halfNode = screen.findAll((node) => node.props?.children === 'half')[0];
        expect(halfNode).toBeTruthy();
        expect(JSON.stringify(halfNode!.props.style)).toContain('Inter-SemiBold');
    }, 60_000);

    it('renders incomplete code fences as cheap text while streaming', async () => {
        const screen = await renderStreamingMarkdown(['```ts', 'const value = 1;'].join('\n'));

        expect(screen.findAllByType('MarkdownCodeBlock')).toHaveLength(0);
        expect(visibleText(screen)).toContain('const value = 1;');
    }, 60_000);

    it('does not instantiate Mermaid for incomplete mermaid fences while streaming', async () => {
        const screen = await renderStreamingMarkdown(['```mermaid', 'graph TD;', 'A-->B'].join('\n'));

        expect(screen.findAllByType('MermaidRenderer')).toHaveLength(0);
        expect(visibleText(screen)).toContain('graph TD;');
    }, 60_000);

    it('keeps incomplete tables out of the table layout while streaming', async () => {
        const screen = await renderStreamingMarkdown(['| A | B |', '| --- | --- |'].join('\n'));

        expect(screen.findByTestId('markdown-table-scroll')).toBe(null);
        expect(visibleText(screen)).toContain('| A | B |');
    }, 60_000);

    it('keeps incomplete options blocks non-clickable while streaming', async () => {
        const screen = await renderStreamingMarkdown(['<options>', '<option>Run command</option>'].join('\n'));

        expect(screen.findAllByType('Pressable')).toHaveLength(0);
        expect(visibleText(screen)).toContain('Run command');
    }, 60_000);

    it('wraps only non-code text for web reveal animation while streaming', async () => {
        const screen = await renderStreamingMarkdown('Hello `code` world', { streamingAnimated: true });

        const revealNodes = screen.findAll((node) => node.props?.['data-happier-streaming-text-reveal'] === 'word');
        expect(revealNodes.map((node) => node.props.children)).toEqual(['Hello', 'world']);
    }, 60_000);
});
