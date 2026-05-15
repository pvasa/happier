import * as React from 'react';
import { useWindowDimensions } from 'react-native';
import { useSharedValue } from 'react-native-reanimated';

import { resolveWebVisualViewportKeyboardInset } from '@/hooks/ui/resolveWebVisualViewportKeyboardInset';
import {
    resolveAvailablePanelHeight,
    resolveComposerBottomOffset,
} from './composerKeyboardGeometry';
import type { ComposerKeyboardLayout } from './ComposerKeyboardContext';
import type { ComposerKeyboardLayoutOptions } from './useComposerKeyboardLayout.native';

function isEditableElementFocused(): boolean {
    if (typeof document === 'undefined') return false;
    const activeElement = document.activeElement;
    if (!activeElement) return false;
    const tagName = activeElement.tagName.toLowerCase();
    return tagName === 'input' || tagName === 'textarea' || activeElement.getAttribute('contenteditable') === 'true';
}

function isMobileLikeHost(width: number): boolean {
    return width < 768;
}

function readVisualViewportKeyboardInset(): number {
    if (typeof window === 'undefined') return 0;
    const visualViewport = window.visualViewport;
    if (!visualViewport) return 0;
    return resolveWebVisualViewportKeyboardInset({
        layoutViewportHeight: window.innerHeight,
        visualViewportHeight: visualViewport.height,
        visualViewportOffsetTop: visualViewport.offsetTop,
        isEditableElementFocused: isEditableElementFocused(),
        isMobileLikeHost: isMobileLikeHost(visualViewport.width),
    });
}

export function useComposerKeyboardLayout(options: ComposerKeyboardLayoutOptions = {}): ComposerKeyboardLayout {
    const dimensions = useWindowDimensions();
    const safeAreaBottom = options.safeAreaBottom ?? 0;
    const headerHeight = options.headerHeight ?? 0;
    const keyboardLiftSuppressed = options.keyboardLiftSuppressed === true;
    const availablePanelHeight = useSharedValue(0);
    const bottomInset = useSharedValue(resolveComposerBottomOffset({ keyboardHeight: 0, safeAreaBottom }));
    const composerHeight = useSharedValue(0);
    const isKeyboardLiftSuppressed = useSharedValue(keyboardLiftSuppressed);
    const keyboardHeightForInset = useSharedValue(0);
    const keyboardHeightLive = useSharedValue(0);
    const keyboardProgress = useSharedValue(0);
    const listBottomInset = useSharedValue(0);
    const availablePanelHeightSubscribersRef = React.useRef(new Set<(height: number) => void>());

    const notifyAvailablePanelHeight = React.useCallback((height: number) => {
        for (const listener of availablePanelHeightSubscribersRef.current) {
            listener(height);
        }
    }, []);

    const subscribeAvailablePanelHeight = React.useCallback((listener: (height: number) => void) => {
        availablePanelHeightSubscribersRef.current.add(listener);
        listener(availablePanelHeight.value);
        return () => {
            availablePanelHeightSubscribersRef.current.delete(listener);
        };
    }, [availablePanelHeight]);

    const recompute = React.useCallback((keyboardHeight: number) => {
        const effectiveKeyboardHeight = keyboardLiftSuppressed ? 0 : keyboardHeight;
        isKeyboardLiftSuppressed.value = keyboardLiftSuppressed;
        keyboardHeightLive.value = keyboardHeight;
        keyboardHeightForInset.value = keyboardHeight;
        keyboardProgress.value = keyboardHeight > 0 ? 1 : 0;
        bottomInset.value = resolveComposerBottomOffset({ keyboardHeight: effectiveKeyboardHeight, safeAreaBottom });
        listBottomInset.value = 0;
        availablePanelHeight.value = resolveAvailablePanelHeight({
            viewportHeight: dimensions.height,
            headerHeight,
            keyboardHeight: effectiveKeyboardHeight,
            safeAreaBottom,
        });
        notifyAvailablePanelHeight(availablePanelHeight.value);
    }, [
        availablePanelHeight,
        bottomInset,
        composerHeight,
        dimensions.height,
        headerHeight,
        isKeyboardLiftSuppressed,
        keyboardHeightForInset,
        keyboardHeightLive,
        keyboardLiftSuppressed,
        keyboardProgress,
        listBottomInset,
        notifyAvailablePanelHeight,
        safeAreaBottom,
    ]);

    React.useEffect(() => {
        const update = () => {
            recompute(readVisualViewportKeyboardInset());
        };
        update();
        if (typeof window === 'undefined') return undefined;
        const visualViewport = window.visualViewport;
        visualViewport?.addEventListener('resize', update);
        visualViewport?.addEventListener('scroll', update);
        window.addEventListener('focusin', update);
        window.addEventListener('focusout', update);
        return () => {
            visualViewport?.removeEventListener('resize', update);
            visualViewport?.removeEventListener('scroll', update);
            window.removeEventListener('focusin', update);
            window.removeEventListener('focusout', update);
        };
    }, [recompute]);

    const setComposerMeasuredHeight = React.useCallback((height: number) => {
        const nextHeight = typeof height === 'number' && Number.isFinite(height) ? Math.max(0, Math.round(height)) : 0;
        if (composerHeight.value === nextHeight) return;
        composerHeight.value = nextHeight;
        recompute(keyboardHeightForInset.value);
    }, [composerHeight, keyboardHeightForInset, recompute]);

    const retainKeyboardLift = React.useCallback(() => () => {}, []);

    return React.useMemo(() => ({
        availablePanelHeight,
        bottomInset,
        composerHeight,
        isKeyboardLiftSuppressed,
        keyboardHeightForInset,
        keyboardHeightLive,
        keyboardProgress,
        listBottomInset,
        retainKeyboardLift,
        setComposerMeasuredHeight,
        subscribeAvailablePanelHeight,
    }), [
        availablePanelHeight,
        bottomInset,
        composerHeight,
        isKeyboardLiftSuppressed,
        keyboardHeightForInset,
        keyboardHeightLive,
        keyboardProgress,
        listBottomInset,
        retainKeyboardLift,
        setComposerMeasuredHeight,
        subscribeAvailablePanelHeight,
    ]);
}
