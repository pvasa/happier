import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';

import type {
    SelectionListOption,
    SelectionListProps,
    SelectionListStep,
} from '../_types';

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock();
});

function makeOptions(count: number, prefix = 'opt'): ReadonlyArray<SelectionListOption> {
    return Array.from({ length: count }, (_, i) => ({
        id: `${prefix}-${i}`,
        label: `Option ${i}`,
    }));
}

function defaultProps(rootStep: SelectionListStep, overrides: Partial<SelectionListProps> = {}): SelectionListProps {
    return {
        rootStep,
        onSelect: vi.fn(),
        onRequestClose: vi.fn(),
        keyboardHintsEnabled: false,
        disableTransitions: true,
        testID: 'sl',
        ...overrides,
    };
}

/**
 * R9 — Blocker 1: Non-virtualized SelectionList rows can clip when the popover
 * sets `scrollEnabled={false}` and the list height exceeds maxHeight. The
 * orchestrator MUST own its own ScrollView around the non-virtualized body so
 * the user can scroll within the popover.
 *
 * The virtualized FlashList path manages its own scroll, so the wrapping
 * ScrollView must NOT swallow that path. The wrapper exposes a stable testID
 * (`sl:bodyScroll`) so other tests + the popover surface contract can rely on
 * the ownership boundary.
 */
describe('SelectionList non-virtualized body scroll wrapper (R9 blocker 1)', () => {
    it('wraps non-virtualized rows in a ScrollView so all rows remain reachable', async () => {
        const root: SelectionListStep = {
            id: 'root',
            inputPlaceholder: 'Search',
            sections: [
                {
                    kind: 'static',
                    id: 'shorty',
                    title: 'SHORTY',
                    options: makeOptions(30, 'short'),
                },
            ],
        };
        const { SelectionList } = await import('../SelectionList');
        const screen = await renderScreen(
            <SelectionList {...defaultProps(root, { maxHeight: 200 })} />,
        );
        // The orchestrator must mount a ScrollView around the non-virtualized
        // body so the user can scroll past maxHeight. Identified via stable
        // testID at the wrapper boundary.
        const scrollWrapper = screen.findByTestId('sl:bodyScroll');
        expect(scrollWrapper).not.toBeNull();
        // Every option in the section must still be present in the rendered
        // tree (ScrollView renders all children up-front; user scrolls).
        for (let i = 0; i < 30; i += 1) {
            const row = screen.findByTestId(`sl:root:option:short-${i}`);
            expect(row).not.toBeNull();
        }
    });

    /**
     * RUX-1 Issue 7: footer outside the scroll container. The user
     * screenshot showed the footer hints rendered AS PART OF the scrolling
     * list, only visible when scrolled to the bottom. The fix:
     *   - SelectionList layout = header (sticky) → body (flex: 1) → footer (sticky)
     *   - Footer must NOT be a descendant of the bodyScroll container.
     *   - Body must be constrained to flex: 1, minHeight: 0 so its
     *     contents scroll inside the bounded area instead of overflowing
     *     past the footer.
     */
    it('renders the footer OUTSIDE the bodyScroll container so it stays visible when the list scrolls', async () => {
        const root: SelectionListStep = {
            id: 'root',
            inputPlaceholder: 'Search',
            sections: [
                {
                    kind: 'static',
                    id: 'big',
                    title: 'BIG',
                    options: makeOptions(30, 'b'),
                },
            ],
            footerHints: [
                { id: 'enter', label: '↵', description: 'commit' },
                { id: 'tab', label: 'Tab', description: 'autocomplete' },
            ],
        };
        const { SelectionList } = await import('../SelectionList');
        const screen = await renderScreen(
            <SelectionList {...defaultProps(root, { maxHeight: 300, keyboardHintsEnabled: true })} />,
        );
        const bodyScroll = screen.findByTestId('sl:bodyScroll');
        const footer = screen.findByTestId('sl:footer');
        expect(bodyScroll).not.toBeNull();
        expect(footer).not.toBeNull();
        // Walk up the parent chain from `footer` — none of its ancestors
        // can be `bodyScroll`. Otherwise the footer scrolls with the body.
        let cur: any = footer;
        let isInsideScroll = false;
        // react-test-renderer instances expose `.parent`; walk the chain.
        while (cur && cur.parent) {
            cur = cur.parent;
            if (cur === bodyScroll) {
                isInsideScroll = true;
                break;
            }
        }
        expect(isInsideScroll).toBe(false);
    });

    it('constrains the body so its contents do not push the footer below maxHeight (flex: 1, minHeight: 0)', async () => {
        const root: SelectionListStep = {
            id: 'root',
            inputPlaceholder: 'Search',
            sections: [
                {
                    kind: 'static',
                    id: 'big',
                    title: 'BIG',
                    options: makeOptions(50, 'b'),
                },
            ],
            footerHints: [
                { id: 'enter', label: '↵', description: 'commit' },
            ],
        };
        const { SelectionList } = await import('../SelectionList');
        const screen = await renderScreen(
            <SelectionList {...defaultProps(root, { maxHeight: 300, keyboardHintsEnabled: true })} />,
        );
        // The content host MUST be flex: 1, minHeight: 0 so the body owns
        // a bounded scrollable area (the alternative — natural height —
        // pushes the footer off-screen as soon as the list grows).
        const content = screen.findByTestId('sl:content') as any;
        expect(content).not.toBeNull();
        const styleProp = content?.props?.style;
        const flatStyle = Array.isArray(styleProp)
            ? Object.assign({}, ...styleProp.filter(Boolean))
            : (styleProp ?? {});
        expect(flatStyle.flex).toBe(1);
        expect(flatStyle.minHeight).toBe(0);
    });

    it('does not mount the ScrollView wrapper when only a virtualized section is present (FlashList owns scroll)', async () => {
        // Force virtualization on a small section so the orchestrator picks
        // the FlashList path. The body MUST defer scrolling to FlashList and
        // skip the wrapping ScrollView (otherwise nested scrolling steals
        // gestures from FlashList).
        const root: SelectionListStep = {
            id: 'root',
            inputPlaceholder: 'Search',
            sections: [
                {
                    kind: 'static',
                    id: 'big',
                    title: 'BIG',
                    options: makeOptions(60, 'b'),
                    virtualization: 'force',
                },
            ],
        };
        const { SelectionList } = await import('../SelectionList');
        const screen = await renderScreen(<SelectionList {...defaultProps(root)} />);
        expect(screen.findByTestId('sl:bodyScroll')).toBeNull();
    });
});
