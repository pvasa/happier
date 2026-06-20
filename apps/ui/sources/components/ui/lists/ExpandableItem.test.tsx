import React from 'react';
import { View } from 'react-native';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderScreen } from '@/dev/testkit';
import { lightTheme } from '@/theme';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock();
});

vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock();
});

const reducedMotionRef = vi.hoisted(() => ({ value: false }));
vi.mock('@/hooks/ui/useReducedMotionPreference', () => ({
    useReducedMotionPreference: () => reducedMotionRef.value,
}));

const animationControls = vi.hoisted(() => ({
    timingCalls: [] as Array<{ to: unknown }>,
}));

vi.mock('react-native-reanimated', async () => {
    const ReactModule = await import('react');
    type SharedValue<T> = { value: T };
    const useSharedValue = <T,>(initial: T): SharedValue<T> => {
        const ref = ReactModule.useRef<SharedValue<T> | null>(null);
        if (!ref.current) ref.current = { value: initial };
        return ref.current;
    };
    const useAnimatedStyle = <T,>(factory: () => T): T => factory();
    const runOnJS = <TArgs extends unknown[], TResult>(fn: (...args: TArgs) => TResult) => fn;
    const cancelAnimation = () => {};
    const withTiming = <T,>(value: T, _config?: unknown, callback?: (finished?: boolean) => void) => {
        animationControls.timingCalls.push({ to: value });
        if (callback) callback(true);
        return value;
    };
    const Animated = {
        View: 'Animated.View',
        ScrollView: 'Animated.ScrollView',
        Text: 'Animated.Text',
        createAnimatedComponent: (component: unknown) => component,
    };
    return {
        __esModule: true,
        default: Animated,
        ...Animated,
        cancelAnimation,
        runOnJS,
        useAnimatedStyle,
        useSharedValue,
        withTiming,
    };
});

beforeEach(() => {
    animationControls.timingCalls = [];
    reducedMotionRef.value = false;
});

/**
 * Lightweight header that records the `showDivider` ExpandableItem clones onto
 * it (the caller's header Item normally consumes this to draw its row divider).
 */
function HeaderProbe(props: { testID?: string; showDivider?: boolean; expanded?: boolean }) {
    return <View testID={props.testID} />;
}

function flattenStyle(style: unknown): Record<string, unknown> {
    if (Array.isArray(style)) {
        return style.reduce<Record<string, unknown>>(
            (accumulator, entry) => Object.assign(accumulator, flattenStyle(entry)),
            {},
        );
    }
    if (style && typeof style === 'object') {
        return style as Record<string, unknown>;
    }
    return {};
}

describe('ExpandableItem', () => {
    it('renders only the header when collapsed and reveals the body when expanded', async () => {
        const { ExpandableItem } = await import('./ExpandableItem');

        const collapsed = await renderScreen(
            <ExpandableItem
                testID="acct"
                expanded={false}
                onExpandedChange={() => {}}
                header={(s) => <HeaderProbe testID="hdr" expanded={s.expanded} {...s.headerProps} />}
            >
                <View testID="body-content" />
            </ExpandableItem>,
        );
        expect(collapsed.findByTestId('hdr')).toBeTruthy();
        expect(collapsed.findAllByTestId('body-content').length).toBe(0);

        const expanded = await renderScreen(
            <ExpandableItem
                testID="acct"
                expanded
                onExpandedChange={() => {}}
                header={(s) => <HeaderProbe testID="hdr" expanded={s.expanded} {...s.headerProps} />}
            >
                <View testID="body-content" />
            </ExpandableItem>,
        );
        expect(expanded.findAllByTestId('body-content').length).toBe(1);
    });

    it('collapsed middle item draws ONLY an inter-item hairline below the header', async () => {
        const { ExpandableItem } = await import('./ExpandableItem');
        const screen = await renderScreen(
            <ExpandableItem
                testID="acct"
                expanded={false}
                showDivider
                onExpandedChange={() => {}}
                header={(s) => <HeaderProbe testID="hdr" expanded={s.expanded} {...s.headerProps} />}
            >
                <View testID="body-content" />
            </ExpandableItem>,
        );

        // ExpandableItem owns the inter-item hairline so it paints on every
        // platform; the header Item never draws its own zero-height-on-web
        // divider, and there is no internal line in a collapsed row.
        expect(screen.findByType(HeaderProbe).props.showDivider).toBe(false);
        expect(screen.findAllByTestId('acct:body-divider').length).toBe(0);
        expect(screen.findAllByTestId('acct:row-divider').length).toBe(1);
    });

    it('paints the inter-item hairline as a faint line using the canonical border token', async () => {
        const { ExpandableItem } = await import('./ExpandableItem');
        const screen = await renderScreen(
            <ExpandableItem
                testID="acct"
                expanded
                showDivider
                onExpandedChange={() => {}}
                header={(s) => <HeaderProbe testID="hdr" expanded={s.expanded} {...s.headerProps} />}
            >
                <View testID="body-content" />
            </ExpandableItem>,
        );

        const rowDivider = flattenStyle(screen.findByTestId('acct:row-divider')?.props.style);

        // The hairline must actually paint (non-zero height) and use the
        // canonical themed divider token, not a hardcoded color, but stay subtle
        // via a reduced opacity rather than a hard, fully-opaque rule.
        expect(Number(rowDivider.height)).toBeGreaterThan(0);
        expect(rowDivider.backgroundColor).toBe(lightTheme.colors.border.default);
        expect(Number(rowDivider.opacity)).toBeGreaterThan(0);
        expect(Number(rowDivider.opacity)).toBeLessThan(1);

        // No line is ever drawn inside the item (header ↔ body).
        expect(screen.findAllByTestId('acct:body-divider').length).toBe(0);
    });

    it('expanded middle item draws ONLY an inter-item hairline below the body, never inside', async () => {
        const { ExpandableItem } = await import('./ExpandableItem');
        const screen = await renderScreen(
            <ExpandableItem
                testID="acct"
                expanded
                showDivider
                onExpandedChange={() => {}}
                header={(s) => <HeaderProbe testID="hdr" expanded={s.expanded} {...s.headerProps} />}
            >
                <View testID="body-content" />
            </ExpandableItem>,
        );

        expect(screen.findByType(HeaderProbe).props.showDivider).toBe(false);
        // No header ↔ body line inside the expanded item.
        expect(screen.findAllByTestId('acct:body-divider').length).toBe(0);
        // Only the inter-item separator below the body remains.
        expect(screen.findAllByTestId('acct:row-divider').length).toBe(1);
    });

    it('last expanded item draws no internal line and no below-body inter-item separator', async () => {
        const { ExpandableItem } = await import('./ExpandableItem');
        const screen = await renderScreen(
            <ExpandableItem
                testID="acct"
                expanded
                showDivider={false}
                onExpandedChange={() => {}}
                header={(s) => <HeaderProbe testID="hdr" expanded={s.expanded} {...s.headerProps} />}
            >
                <View testID="body-content" />
            </ExpandableItem>,
        );

        expect(screen.findByType(HeaderProbe).props.showDivider).toBe(false);
        // Last row: no internal line and no trailing inter-item separator.
        expect(screen.findAllByTestId('acct:body-divider').length).toBe(0);
        expect(screen.findAllByTestId('acct:row-divider').length).toBe(0);
    });

    it('occupies exactly one row slot so ItemGroup dividers/corners apply per item', async () => {
        const { ExpandableItem } = await import('./ExpandableItem');
        const { withItemGroupDividers } = await import('./ItemGroup.dividers');
        const { ItemGroupRowPositionProvider } = await import('./ItemGroupRowPosition');

        const makeItem = (key: string) => (
            <ExpandableItem
                key={key}
                expanded={false}
                onExpandedChange={() => {}}
                header={<HeaderProbe testID={`hdr-${key}`} />}
            >
                <View />
            </ExpandableItem>
        );

        const processed = withItemGroupDividers([makeItem('a'), makeItem('b'), makeItem('c')]);

        const positions: Array<{ isFirst: boolean; isLast: boolean; showDivider: unknown }> = [];
        React.Children.forEach(processed, (child) => {
            if (!React.isValidElement(child)) return;
            if (child.type !== ItemGroupRowPositionProvider) return;
            const provider = child as React.ReactElement<{
                value: { isFirst: boolean; isLast: boolean };
                children?: React.ReactNode;
            }>;
            const inner = React.Children.toArray(provider.props.children)[0];
            if (!React.isValidElement(inner) || inner.type !== ExpandableItem) return;
            const element = inner as React.ReactElement<{ showDivider?: boolean }>;
            positions.push({
                isFirst: provider.props.value.isFirst,
                isLast: provider.props.value.isLast,
                showDivider: element.props.showDivider,
            });
        });

        // Three ExpandableItems -> three single row slots with correct corners + dividers.
        expect(positions).toEqual([
            { isFirst: true, isLast: false, showDivider: true },
            { isFirst: false, isLast: false, showDivider: true },
            { isFirst: false, isLast: true, showDivider: false },
        ]);
    });

    it('toggles via the header onPress (controlled)', async () => {
        const { ExpandableItem } = await import('./ExpandableItem');
        const onExpandedChange = vi.fn();
        const screen = await renderScreen(
            <ExpandableItem
                testID="acct"
                expanded={false}
                onExpandedChange={onExpandedChange}
                header={(s) => <HeaderProbe testID="hdr" expanded={s.expanded} {...s.headerProps} />}
            >
                <View testID="body-content" />
            </ExpandableItem>,
        );

        screen.findByTestId('hdr')?.props.onPress?.();
        expect(onExpandedChange).toHaveBeenCalledWith(true);
    });

    it('snaps without withTiming when reduced motion is preferred', async () => {
        reducedMotionRef.value = true;
        const { ExpandableItem } = await import('./ExpandableItem');
        const screen = await renderScreen(
            <ExpandableItem
                testID="acct"
                expanded={false}
                onExpandedChange={() => {}}
                header={(s) => <HeaderProbe testID="hdr" expanded={s.expanded} {...s.headerProps} />}
            >
                <View testID="body-content" />
            </ExpandableItem>,
        );

        animationControls.timingCalls = [];
        await screen.update(
            <ExpandableItem
                testID="acct"
                expanded
                onExpandedChange={() => {}}
                header={(s) => <HeaderProbe testID="hdr" expanded={s.expanded} {...s.headerProps} />}
            >
                <View testID="body-content" />
            </ExpandableItem>,
        );

        expect(animationControls.timingCalls.length).toBe(0);
        expect(screen.findAllByTestId('body-content').length).toBe(1);
    });

    it('animates with withTiming when expanding and motion is allowed', async () => {
        reducedMotionRef.value = false;
        const { ExpandableItem } = await import('./ExpandableItem');
        const screen = await renderScreen(
            <ExpandableItem
                testID="acct"
                expanded={false}
                onExpandedChange={() => {}}
                header={(s) => <HeaderProbe testID="hdr" expanded={s.expanded} {...s.headerProps} />}
            >
                <View testID="body-content" />
            </ExpandableItem>,
        );

        animationControls.timingCalls = [];
        await screen.update(
            <ExpandableItem
                testID="acct"
                expanded
                onExpandedChange={() => {}}
                header={(s) => <HeaderProbe testID="hdr" expanded={s.expanded} {...s.headerProps} />}
            >
                <View testID="body-content" />
            </ExpandableItem>,
        );

        expect(animationControls.timingCalls.length).toBeGreaterThan(0);
    });
});
