import * as React from 'react';

import { Platform, useWindowDimensions } from 'react-native';
import { MODAL_AWARE_FLOATING_POPOVER_PORTAL_OPTIONS, Popover } from '@/components/ui/popover';
import { useComposerKeyboardLayout } from '@/components/sessions/keyboardAvoidance/ComposerKeyboardContext';
import { useKeyboardHeight } from '@/hooks/ui/useKeyboardHeight';

export type AgentInputSelectionPopoverProps = Readonly<{
    open: boolean;
    anchorRef: React.RefObject<any>;
    boundaryRef?: React.RefObject<any> | null;
    onRequestClose: () => void;
    maxHeightCap?: number;
    maxWidthCap?: number;
    children: (args: Readonly<{ maxHeight: number }>) => React.ReactNode;
}>;

const DEFAULT_POPOVER_MAX_HEIGHT = 400;
const NATIVE_KEYBOARD_VISIBLE_POPOVER_FRACTION = 0.5;
const DEFAULT_POPOVER_GAP = 8;
const ANDROID_POPOVER_GAP = 32;

export function AgentInputSelectionPopover(props: AgentInputSelectionPopoverProps) {
    const keyboardHeight = useKeyboardHeight();
    const composerKeyboardLayout = useComposerKeyboardLayout();
    const { height: windowHeight } = useWindowDimensions();
    const [composerKeyboardHeight, setComposerKeyboardHeight] = React.useState(
        () => composerKeyboardLayout?.getKeyboardHeight?.() ?? 0,
    );

    React.useEffect(() => {
        setComposerKeyboardHeight(composerKeyboardLayout?.getKeyboardHeight?.() ?? 0);
        return composerKeyboardLayout?.subscribeKeyboardHeight?.(setComposerKeyboardHeight);
    }, [composerKeyboardLayout]);

    const effectiveKeyboardHeight = Math.max(keyboardHeight, composerKeyboardHeight);
    const maxHeightCap = React.useMemo(() => {
        if (Platform.OS === 'web' || effectiveKeyboardHeight <= 0) {
            return props.maxHeightCap;
        }

        const visibleHeight = Math.max(0, windowHeight - effectiveKeyboardHeight);
        if (visibleHeight <= 0) {
            return props.maxHeightCap;
        }

        const requestedCap = props.maxHeightCap ?? DEFAULT_POPOVER_MAX_HEIGHT;
        const shallowViewportCap = Math.floor(visibleHeight * NATIVE_KEYBOARD_VISIBLE_POPOVER_FRACTION);
        return Math.min(requestedCap, shallowViewportCap);
    }, [effectiveKeyboardHeight, props.maxHeightCap, windowHeight]);
    // On web, agent-input popovers should be constrained to the viewport (not to an in-modal boundary
    // provider), so they can extend outside sheet-like modal cards.
    const boundaryRef =
        Platform.OS === 'web' && props.boundaryRef === undefined
            ? null
            : props.boundaryRef;

    // AgentInput chip popovers should stay visually attached above the chip row. The keyboard-safe
    // boundary and max-height cap keep tall menus inside the visible viewport without flipping them
    // down over the chips.
    const placement = 'top';
    const gap =
        Platform.OS === 'android'
            ? ANDROID_POPOVER_GAP
            : DEFAULT_POPOVER_GAP;

    React.useEffect(() => {
        if (Platform.OS === 'web') return undefined;
        if (!props.open) return undefined;
        if (effectiveKeyboardHeight <= 0) return undefined;
        return composerKeyboardLayout?.retainKeyboardLift?.();
    }, [composerKeyboardLayout, effectiveKeyboardHeight, props.open]);

    return (
        <Popover
            open={props.open}
            anchorRef={props.anchorRef}
            // IMPORTANT:
            // Forward `undefined` so Popover can fall back to PopoverBoundaryProvider context.
            // Passing `null` explicitly disables boundary clamping/measurement, which breaks
            // new-session popover anchoring on native where we rely on a scroll boundary.
            boundaryRef={boundaryRef}
            placement={placement}
            gap={gap}
            maxHeightCap={maxHeightCap}
            maxWidthCap={props.maxWidthCap}
            edgePadding={{ horizontal: 16 }}
            closeOnAnchorPress={false}
            // IMPORTANT:
            // Do not force portaling to `document.body`. In Expo Router web modals, Radix focus/pointer
            // management will block interaction with inputs rendered outside the modal subtree.
            // Let Popover pick the best target (screen-local modal host from PopoverPortalTargetProvider).
            portal={MODAL_AWARE_FLOATING_POPOVER_PORTAL_OPTIONS}
            onRequestClose={props.onRequestClose}
            consumeOutsidePointerDown={false}
            // On web, agent input popovers must NOT block outside pointer events: users should be
            // able to switch between chips in one click (no "click outside to close first").
            // Click-through prevention is handled at the selection layer by deferring popover
            // closure until after the click event completes.
            backdrop={{
                style: { backgroundColor: 'transparent' },
                blockOutsidePointerEvents: Platform.OS === 'web' ? false : 'above-anchor',
            }}
            containerStyle={{ paddingHorizontal: 0 }}
            keyboardBottomInset={Platform.OS === 'web' ? 0 : effectiveKeyboardHeight}
        >
            {({ maxHeight }) => (
                props.children({ maxHeight })
            )}
        </Popover>
    );
}
