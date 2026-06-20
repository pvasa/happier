import * as React from 'react';
import { Platform, useWindowDimensions } from 'react-native';

import { useComposerKeyboardLayout } from '@/components/sessions/keyboardAvoidance/ComposerKeyboardContext';
import { useKeyboardHeight } from '@/hooks/ui/useKeyboardHeight';

const DEFAULT_POPOVER_MAX_HEIGHT = 400;
const NATIVE_KEYBOARD_VISIBLE_POPOVER_FRACTION = 0.5;
const DEFAULT_POPOVER_GAP = 8;

export type AgentInputPopoverLayout = Readonly<{
    maxHeightCap?: number;
    keyboardBottomInset: number;
    placement: 'top';
    gap: number;
}>;

export function useAgentInputPopoverLayout(input: Readonly<{
    open: boolean;
    maxHeightCap?: number;
}>): AgentInputPopoverLayout {
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
            return input.maxHeightCap;
        }

        const visibleHeight = Math.max(0, windowHeight - effectiveKeyboardHeight);
        if (visibleHeight <= 0) {
            return input.maxHeightCap;
        }

        const requestedCap = input.maxHeightCap ?? DEFAULT_POPOVER_MAX_HEIGHT;
        const shallowViewportCap = Math.floor(visibleHeight * NATIVE_KEYBOARD_VISIBLE_POPOVER_FRACTION);
        return Math.min(requestedCap, shallowViewportCap);
    }, [effectiveKeyboardHeight, input.maxHeightCap, windowHeight]);

    React.useEffect(() => {
        if (Platform.OS === 'web') return undefined;
        if (!input.open) return undefined;
        if (effectiveKeyboardHeight <= 0) return undefined;
        return composerKeyboardLayout?.retainKeyboardLift?.();
    }, [composerKeyboardLayout, effectiveKeyboardHeight, input.open]);

    return {
        maxHeightCap,
        keyboardBottomInset: Platform.OS === 'web' ? 0 : effectiveKeyboardHeight,
        placement: 'top',
        // The popover now anchors correctly on every platform (Popover resolves the portal-relative
        // anchor via window-deltas on Android — see `resolvePortalRelativeAnchorRect`), so the gap is
        // the same snug value everywhere. Previously Android over-padded (32) to mask an anchor that
        // was resolved in the wrong coordinate space and overlapped the chip.
        gap: DEFAULT_POPOVER_GAP,
    };
}
