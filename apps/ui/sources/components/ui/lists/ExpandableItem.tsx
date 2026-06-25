import * as React from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import Animated, {
    cancelAnimation,
    runOnJS,
    useAnimatedStyle,
    useSharedValue,
    withTiming,
    type WithTimingConfig,
} from 'react-native-reanimated';
import { StyleSheet } from 'react-native-unistyles';

import { useReducedMotionPreference } from '@/hooks/ui/useReducedMotionPreference';

/**
 * Generic accordion row. Owns WAI-ARIA disclosure semantics (the caller's
 * header `Item` becomes the toggle button via `headerProps`) plus a fluid,
 * Reanimated height/opacity body reveal that animates ONLY the toggled item.
 *
 * Integration with `ItemGroup`: `withItemGroupDividers` clones each top-level
 * element child with a computed `showDivider` and wraps it in an
 * `ItemGroupRowPositionProvider`. ExpandableItem therefore returns a SINGLE
 * non-Fragment wrapper so it occupies exactly one row slot. ExpandableItem owns
 * its inter-item hairline itself (the header `Item`'s own divider is suppressed)
 * so the separation paints consistently across platforms — a header-drawn
 * divider collapses to a zero-height line on web/Android.
 *
 * Dividers appear ONLY between items, NEVER inside one. An expanded item shows
 * no line between its header and its body. The injected `showDivider` therefore
 * drives a single inter-item separator placed after the row content:
 *   - collapsed -> a hairline BELOW the header (when not the last row)
 *   - expanded  -> a hairline BELOW the body (when not the last row)
 */
export interface ExpandableItemHeaderState {
    expanded: boolean;
    toggle: () => void;
    headerProps: {
        onPress: () => void;
        accessibilityRole: 'button';
        accessibilityState: { expanded: boolean };
    };
}

export type ExpandableItemHeaderRender =
    | React.ReactNode
    | ((state: ExpandableItemHeaderState) => React.ReactNode);

export interface ExpandableItemProps {
    expanded: boolean;
    onExpandedChange: (next: boolean) => void;
    header: ExpandableItemHeaderRender;
    children?: React.ReactNode;
    reorderHandle?: React.ReactNode;
    showDivider?: boolean;
    testID?: string;
    reducedMotion?: boolean;
}

const EXPAND_ANIMATION_DURATION_MS = 220;
const TIMING_CONFIG: WithTimingConfig = { duration: EXPAND_ANIMATION_DURATION_MS };

// Thinnest line that still paints on every platform. The previous
// `Platform.select({ ios: 0.33, default: 0 })` collapsed to zero height on
// web/Android, leaving account rows with no visible separation.
const HAIRLINE = StyleSheet.hairlineWidth || 0.5;

// The separator uses the canonical `border.default` token (there is no
// dedicated subtle/divider token), softened with a low opacity so the
// inter-item hairline reads as a faint line rather than a hard rule.
const HAIRLINE_OPACITY = 0.6;

const stylesheet = StyleSheet.create((theme) => ({
    wrapper: {
        // A single row slot inside the ItemGroup surface. No corner/position
        // provider here: the header Item reads the injected row position.
    },
    headerRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    reorderHandle: {
        justifyContent: 'center',
    },
    headerFlex: {
        flex: 1,
        minWidth: 0,
    },
    bodyClip: {
        overflow: 'hidden',
    },
    rowSeparator: {
        height: HAIRLINE,
        backgroundColor: theme.colors.border.default,
        opacity: HAIRLINE_OPACITY,
        marginLeft: 16,
    },
}));

export const ExpandableItem = React.memo<ExpandableItemProps>((props) => {
    const { expanded, onExpandedChange, header, children, reorderHandle, testID } = props;
    const showDivider = props.showDivider ?? true;
    const styles = stylesheet;

    const detectedReducedMotion = useReducedMotionPreference();
    const reducedMotion = props.reducedMotion ?? detectedReducedMotion;

    const toggle = React.useCallback(() => {
        onExpandedChange(!expanded);
    }, [expanded, onExpandedChange]);

    const headerProps = React.useMemo<ExpandableItemHeaderState['headerProps']>(() => ({
        onPress: toggle,
        accessibilityRole: 'button',
        accessibilityState: { expanded },
    }), [toggle, expanded]);

    // --- body reveal animation (only this item animates) ---
    const measuredHeightRef = React.useRef(0);
    const animatedHeight = useSharedValue(0);
    const animatedOpacity = useSharedValue(expanded ? 1 : 0);
    const isMountedRef = React.useRef(true);
    const pendingExpandRef = React.useRef(false);
    const prevExpandedRef = React.useRef(expanded);

    const [bodyMounted, setBodyMounted] = React.useState(expanded);
    const [heightPinned, setHeightPinned] = React.useState(false);

    React.useEffect(() => {
        isMountedRef.current = true;
        return () => {
            isMountedRef.current = false;
            cancelAnimation(animatedHeight);
            cancelAnimation(animatedOpacity);
        };
    }, [animatedHeight, animatedOpacity]);

    const settleExpanded = React.useCallback(() => {
        if (!isMountedRef.current) return;
        // Release the pin so the body renders at natural height and can grow.
        setHeightPinned(false);
    }, []);

    const settleCollapsed = React.useCallback(() => {
        if (!isMountedRef.current) return;
        setBodyMounted(false);
        setHeightPinned(false);
    }, []);

    React.useEffect(() => {
        if (prevExpandedRef.current === expanded) return;
        prevExpandedRef.current = expanded;

        if (expanded) {
            setBodyMounted(true);
            if (reducedMotion) {
                animatedOpacity.value = 1;
                setHeightPinned(false);
                return;
            }
            animatedHeight.value = 0;
            setHeightPinned(true);
            pendingExpandRef.current = true;
            animatedOpacity.value = withTiming(1, TIMING_CONFIG);
            const target = measuredHeightRef.current;
            if (target > 0) {
                pendingExpandRef.current = false;
                animatedHeight.value = withTiming(target, TIMING_CONFIG, (finished) => {
                    'worklet';
                    if (finished) runOnJS(settleExpanded)();
                });
            }
            return;
        }

        // Collapse.
        if (reducedMotion) {
            animatedOpacity.value = 0;
            settleCollapsed();
            return;
        }
        pendingExpandRef.current = false;
        animatedHeight.value = measuredHeightRef.current > 0 ? measuredHeightRef.current : 0;
        setHeightPinned(true);
        animatedOpacity.value = withTiming(0, TIMING_CONFIG);
        animatedHeight.value = withTiming(0, TIMING_CONFIG, (finished) => {
            'worklet';
            if (finished) runOnJS(settleCollapsed)();
        });
    }, [expanded, reducedMotion, animatedHeight, animatedOpacity, settleExpanded, settleCollapsed]);

    const handleBodyLayout = React.useCallback((event: LayoutChangeEvent) => {
        const measured = event.nativeEvent.layout.height;
        if (measured <= 0) return;
        measuredHeightRef.current = measured;
        if (pendingExpandRef.current && !reducedMotion) {
            pendingExpandRef.current = false;
            animatedHeight.value = withTiming(measured, TIMING_CONFIG, (finished) => {
                'worklet';
                if (finished) runOnJS(settleExpanded)();
            });
        }
    }, [animatedHeight, reducedMotion, settleExpanded]);

    const bodyAnimatedStyle = useAnimatedStyle(() => {
        // ALWAYS return the same set of keys. Reanimated's native updater does not
        // reset a property that simply disappears from the returned object, so
        // dropping `height` (rather than setting it to `undefined`) freezes the
        // native view at the height captured during the open animation — which is
        // short when the body's content (e.g. an async quota snapshot) grows after
        // the first onLayout. Returning `height: undefined` when unpinned releases
        // the constraint so the body settles at its natural, full height.
        return {
            opacity: animatedOpacity.value,
            height: heightPinned ? animatedHeight.value : undefined,
        };
    }, [heightPinned]);

    // The header `Item` never draws its own row-separator: its divider is a
    // zero-height line on web/Android, so ExpandableItem owns the single
    // inter-item hairline itself to guarantee a consistent, faint separation
    // across platforms. No line is ever drawn inside an item.
    const resolvedHeader = typeof header === 'function'
        ? header({ expanded, toggle, headerProps })
        : header;
    const headerNode = React.isValidElement(resolvedHeader)
        ? React.cloneElement(
            resolvedHeader as React.ReactElement<{ showDivider?: boolean }>,
            { showDivider: false },
        )
        : resolvedHeader;

    return (
        <View testID={testID} style={styles.wrapper}>
            {reorderHandle != null ? (
                <View style={styles.headerRow}>
                    <View style={styles.reorderHandle}>{reorderHandle}</View>
                    <View style={styles.headerFlex}>{headerNode}</View>
                </View>
            ) : (
                headerNode
            )}

            {bodyMounted ? (
                <Animated.View
                    testID={testID ? `${testID}:body` : undefined}
                    style={[styles.bodyClip, bodyAnimatedStyle]}
                >
                    <View onLayout={handleBodyLayout}>
                        {children}
                    </View>
                </Animated.View>
            ) : null}

            {showDivider ? (
                <View
                    testID={testID ? `${testID}:row-divider` : undefined}
                    style={styles.rowSeparator}
                />
            ) : null}
        </View>
    );
});

ExpandableItem.displayName = 'ExpandableItem';
