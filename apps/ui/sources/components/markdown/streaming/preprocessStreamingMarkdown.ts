import remend, { type RemendOptions } from 'remend';

const STREAMING_MARKDOWN_REMEND_OPTIONS: RemendOptions = {
    inlineKatex: false,
    katex: false,
    linkMode: 'text-only',
    htmlTags: false,
};

export function preprocessStreamingMarkdown(markdown: string): string {
    return remend(markdown, STREAMING_MARKDOWN_REMEND_OPTIONS);
}
