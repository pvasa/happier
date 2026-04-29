import React from 'react';
import { describe, expect, it } from 'vitest';

import { renderScreen } from '@/dev/testkit';
import { installMarkdownCommonModuleMocks } from './markdownTestHelpers';
import { createReactNativeWebMock } from '@/dev/testkit/mocks/reactNative';

declare global {
    // eslint-disable-next-line no-var
    var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

installMarkdownCommonModuleMocks({
    reactNative: () =>
        createReactNativeWebMock({
            Platform: { OS: 'ios' },
        }),
});

describe('MarkdownView (native streaming reveal)', () => {
    it('keeps native streaming text as selectable text without per-word wrappers', async () => {
        const { MarkdownView } = await import('./MarkdownView');

        const screen = await renderScreen(
            <MarkdownView
                markdown="Hello native world"
                streamingMode="streaming"
                streamingAnimated
            />,
        );

        const revealNodes = screen.findAll((node) => node.props?.['data-happier-streaming-text-reveal'] === 'word');
        expect(revealNodes).toHaveLength(0);
        expect(screen.root.findByProps({ children: 'Hello native world' }).props.selectable).toBe(true);
    });
});
