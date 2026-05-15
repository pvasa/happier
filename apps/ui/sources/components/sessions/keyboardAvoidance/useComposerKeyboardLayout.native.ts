import * as React from 'react';
import { useWindowDimensions } from 'react-native';
import { useKeyboardHandler, useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import { runOnJS, useSharedValue } from 'react-native-reanimated';

import {
    resolveAvailablePanelHeight,
    resolveComposerBottomOffset,
    resolveKeyboardHeightRelativeToLayout,
    resolveListBottomInset,
} from './composerKeyboardGeometry';
import type { ComposerKeyboardLayout } from './ComposerKeyboardContext';

export type ComposerKeyboardLayoutOptions = Readonly<{
    headerHeight?: number;
    keyboardLiftSuppressed?: boolean;
    layoutBottomInset?: number;
    safeAreaBottom?: number;
}>;

export function useComposerKeyboardLayout(options: ComposerKeyboardLayoutOptions = {}): ComposerKeyboardLayout {
    const dimensions = useWindowDimensions();
    const safeAreaBottom = options.safeAreaBottom ?? 0;
    const headerHeight = options.headerHeight ?? 0;
    const layoutBottomInset = typeof options.layoutBottomInset === 'number' && Number.isFinite(options.layoutBottomInset)
        ? Math.max(0, options.layoutBottomInset)
        : 0;
    const keyboardLiftSuppressed = options.keyboardLiftSuppressed === true;

    const keyboardAnimation = useReanimatedKeyboardAnimation();
    const availablePanelHeight = useSharedValue(resolveAvailablePanelHeight({
        viewportHeight: dimensions.height,
        headerHeight,
        keyboardHeight: 0,
        reservedHeight: layoutBottomInset,
        safeAreaBottom,
    }));
    const bottomInset = useSharedValue(resolveComposerBottomOffset({ keyboardHeight: 0, safeAreaBottom }));
    const composerHeight = useSharedValue(0);
    const isInteractiveDismissActive = useSharedValue(false);
    const isKeyboardLiftSuppressed = useSharedValue(keyboardLiftSuppressed);
    const isKeyboardLiftRetained = useSharedValue(false);
    const keyboardHeightForInset = useSharedValue(0);
    const keyboardHeightAbsolute = useSharedValue(0);
    const keyboardHeightLive = useSharedValue(0);
    const keyboardProgress = useSharedValue(0);
    const lastKeyboardEventHeightAbsolute = useSharedValue(0);
    const listBottomInset = useSharedValue(resolveListBottomInset({
        composerHeight: 0,
        keyboardHeightForInset: 0,
        safeAreaBottom,
    }));
    const safeAreaBottomValue = useSharedValue(safeAreaBottom);
    const layoutBottomInsetValue = useSharedValue(layoutBottomInset);
    const headerHeightValue = useSharedValue(headerHeight);
    const viewportHeight = useSharedValue(dimensions.height);
    const availablePanelHeightSubscribersRef = React.useRef(new Set<(height: number) => void>());
    const keyboardRetentionCountRef = React.useRef(0);

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

    const recomputeStaticLayout = React.useCallback(() => {
        const liveKeyboardHeight = isKeyboardLiftSuppressed.value
            ? 0
            : resolveKeyboardHeightRelativeToLayout({
                keyboardHeight: keyboardHeightAbsolute.value,
                layoutBottomInset: layoutBottomInsetValue.value,
            });
        keyboardHeightLive.value = liveKeyboardHeight;
        if (isKeyboardLiftSuppressed.value || !isInteractiveDismissActive.value) {
            keyboardHeightForInset.value = liveKeyboardHeight;
        }
        const insetKeyboardHeight = isKeyboardLiftSuppressed.value ? 0 : keyboardHeightForInset.value;
        bottomInset.value = resolveComposerBottomOffset({
            keyboardHeight: liveKeyboardHeight,
            safeAreaBottom: safeAreaBottomValue.value,
        });
        listBottomInset.value = resolveListBottomInset({
            composerHeight: composerHeight.value,
            keyboardHeightForInset: insetKeyboardHeight,
            safeAreaBottom: safeAreaBottomValue.value,
        });
        const absoluteKeyboardHeight = isKeyboardLiftSuppressed.value ? 0 : keyboardHeightAbsolute.value;
        availablePanelHeight.value = resolveAvailablePanelHeight({
            viewportHeight: viewportHeight.value,
            headerHeight: headerHeightValue.value,
            keyboardHeight: absoluteKeyboardHeight,
            reservedHeight: absoluteKeyboardHeight > 0 ? 0 : layoutBottomInsetValue.value,
            safeAreaBottom: safeAreaBottomValue.value,
        });
        notifyAvailablePanelHeight(availablePanelHeight.value);
    }, [
        availablePanelHeight,
        bottomInset,
        composerHeight,
        headerHeightValue,
        isInteractiveDismissActive,
        isKeyboardLiftSuppressed,
        keyboardHeightAbsolute,
        keyboardHeightForInset,
        keyboardHeightLive,
        layoutBottomInsetValue,
        listBottomInset,
        notifyAvailablePanelHeight,
        safeAreaBottomValue,
        viewportHeight,
    ]);

    React.useEffect(() => {
        safeAreaBottomValue.value = safeAreaBottom;
        layoutBottomInsetValue.value = layoutBottomInset;
        headerHeightValue.value = headerHeight;
        viewportHeight.value = dimensions.height;
        isKeyboardLiftSuppressed.value = keyboardLiftSuppressed;
        if (keyboardLiftSuppressed) {
            isInteractiveDismissActive.value = false;
            keyboardHeightAbsolute.value = 0;
            keyboardHeightLive.value = 0;
            keyboardHeightForInset.value = 0;
            keyboardProgress.value = 0;
        }
        recomputeStaticLayout();
    }, [
        dimensions.height,
        headerHeight,
        headerHeightValue,
        isInteractiveDismissActive,
        isKeyboardLiftSuppressed,
        keyboardHeightAbsolute,
        keyboardHeightForInset,
        keyboardHeightLive,
        keyboardLiftSuppressed,
        keyboardProgress,
        recomputeStaticLayout,
        layoutBottomInset,
        layoutBottomInsetValue,
        safeAreaBottom,
        safeAreaBottomValue,
        viewportHeight,
    ]);

    useKeyboardHandler({
        onStart: (event) => {
            'worklet';
            isInteractiveDismissActive.value = false;
            const nextHeight = Math.max(0, Math.abs(event.height));
            lastKeyboardEventHeightAbsolute.value = nextHeight;
            const retainedHeight = !isKeyboardLiftSuppressed.value
                && isKeyboardLiftRetained.value
                && nextHeight === 0
                ? keyboardHeightAbsolute.value
                : nextHeight;
            keyboardHeightAbsolute.value = isKeyboardLiftSuppressed.value ? 0 : retainedHeight;
            const storedHeight = isKeyboardLiftSuppressed.value
                ? 0
                : Math.max(0, retainedHeight - Math.max(0, layoutBottomInsetValue.value));
            keyboardHeightLive.value = storedHeight;
            keyboardHeightForInset.value = storedHeight;
            keyboardProgress.value = isKeyboardLiftSuppressed.value ? 0 : event.progress;
            const effectiveLiveHeight = storedHeight;
            bottomInset.value = Math.max(safeAreaBottomValue.value, effectiveLiveHeight);
            listBottomInset.value = composerHeight.value + Math.max(safeAreaBottomValue.value, effectiveLiveHeight);
            const nextAvailablePanelHeight = Math.max(
                0,
                viewportHeight.value
                    - headerHeightValue.value
                    - Math.max(safeAreaBottomValue.value, keyboardHeightAbsolute.value)
                    - (keyboardHeightAbsolute.value > 0 ? 0 : layoutBottomInsetValue.value),
            );
            availablePanelHeight.value = nextAvailablePanelHeight;
            runOnJS(notifyAvailablePanelHeight)(nextAvailablePanelHeight);
        },
        onMove: (event) => {
            'worklet';
            const eventHeight = Math.max(0, Math.abs(event.height));
            const reanimatedHeight = Math.max(0, Math.abs(keyboardAnimation.height.value));
            const keyboardLiftIsSuppressed = isKeyboardLiftSuppressed.value;
            if (keyboardLiftIsSuppressed) {
                isInteractiveDismissActive.value = false;
            }
            const rawAbsoluteLiveHeight = Math.max(eventHeight, reanimatedHeight);
            lastKeyboardEventHeightAbsolute.value = rawAbsoluteLiveHeight;
            const absoluteLiveHeight = !keyboardLiftIsSuppressed
                && isKeyboardLiftRetained.value
                && rawAbsoluteLiveHeight === 0
                ? keyboardHeightAbsolute.value
                : rawAbsoluteLiveHeight;
            keyboardHeightAbsolute.value = keyboardLiftIsSuppressed ? 0 : absoluteLiveHeight;
            const liveHeight = keyboardLiftIsSuppressed
                ? 0
                : Math.max(0, absoluteLiveHeight - Math.max(0, layoutBottomInsetValue.value));
            const insetHeight = isInteractiveDismissActive.value ? keyboardHeightForInset.value : liveHeight;
            const effectiveLiveHeight = liveHeight;
            const effectiveInsetHeight = keyboardLiftIsSuppressed ? 0 : insetHeight;
            keyboardHeightLive.value = liveHeight;
            if (keyboardLiftIsSuppressed || !isInteractiveDismissActive.value) {
                keyboardHeightForInset.value = insetHeight;
            }
            keyboardProgress.value = keyboardLiftIsSuppressed ? 0 : event.progress;
            bottomInset.value = Math.max(safeAreaBottomValue.value, effectiveLiveHeight);
            listBottomInset.value = composerHeight.value + Math.max(safeAreaBottomValue.value, effectiveInsetHeight);
            availablePanelHeight.value = Math.max(
                0,
                viewportHeight.value
                    - headerHeightValue.value
                    - Math.max(safeAreaBottomValue.value, keyboardHeightAbsolute.value)
                    - (keyboardHeightAbsolute.value > 0 ? 0 : layoutBottomInsetValue.value),
            );
        },
        onInteractive: (event) => {
            'worklet';
            const keyboardLiftIsSuppressed = isKeyboardLiftSuppressed.value;
            isInteractiveDismissActive.value = !keyboardLiftIsSuppressed;
            const eventHeight = Math.max(0, Math.abs(event.height));
            lastKeyboardEventHeightAbsolute.value = eventHeight;
            const liveHeight = !keyboardLiftIsSuppressed
                && isKeyboardLiftRetained.value
                && eventHeight === 0
                ? keyboardHeightAbsolute.value
                : eventHeight;
            keyboardHeightAbsolute.value = keyboardLiftIsSuppressed ? 0 : liveHeight;
            const effectiveLiveHeight = keyboardLiftIsSuppressed
                ? 0
                : Math.max(0, liveHeight - Math.max(0, layoutBottomInsetValue.value));
            keyboardHeightLive.value = effectiveLiveHeight;
            if (keyboardLiftIsSuppressed) {
                keyboardHeightForInset.value = 0;
            }
            keyboardProgress.value = keyboardLiftIsSuppressed ? 0 : event.progress;
            bottomInset.value = Math.max(safeAreaBottomValue.value, effectiveLiveHeight);
            listBottomInset.value = composerHeight.value + Math.max(
                safeAreaBottomValue.value,
                keyboardLiftIsSuppressed ? 0 : keyboardHeightForInset.value,
            );
            availablePanelHeight.value = Math.max(
                0,
                viewportHeight.value
                    - headerHeightValue.value
                    - Math.max(safeAreaBottomValue.value, keyboardHeightAbsolute.value)
                    - (keyboardHeightAbsolute.value > 0 ? 0 : layoutBottomInsetValue.value),
            );
        },
        onEnd: (event) => {
            'worklet';
            isInteractiveDismissActive.value = false;
            const nextHeight = Math.max(0, Math.abs(event.height));
            lastKeyboardEventHeightAbsolute.value = nextHeight;
            const retainedHeight = !isKeyboardLiftSuppressed.value
                && isKeyboardLiftRetained.value
                && nextHeight === 0
                ? keyboardHeightAbsolute.value
                : nextHeight;
            keyboardHeightAbsolute.value = isKeyboardLiftSuppressed.value ? 0 : retainedHeight;
            const effectiveHeight = isKeyboardLiftSuppressed.value
                ? 0
                : Math.max(0, retainedHeight - Math.max(0, layoutBottomInsetValue.value));
            keyboardHeightLive.value = effectiveHeight;
            keyboardHeightForInset.value = effectiveHeight;
            keyboardProgress.value = isKeyboardLiftSuppressed.value ? 0 : event.progress;
            bottomInset.value = Math.max(safeAreaBottomValue.value, effectiveHeight);
            listBottomInset.value = composerHeight.value + Math.max(safeAreaBottomValue.value, effectiveHeight);
            const nextAvailablePanelHeight = Math.max(
                0,
                viewportHeight.value
                    - headerHeightValue.value
                    - Math.max(safeAreaBottomValue.value, keyboardHeightAbsolute.value)
                    - (keyboardHeightAbsolute.value > 0 ? 0 : layoutBottomInsetValue.value),
            );
            availablePanelHeight.value = nextAvailablePanelHeight;
            runOnJS(notifyAvailablePanelHeight)(nextAvailablePanelHeight);
        },
    }, [keyboardAnimation.height]);

    const retainKeyboardLift = React.useCallback(() => {
        let released = false;
        keyboardRetentionCountRef.current += 1;
        isKeyboardLiftRetained.value = keyboardRetentionCountRef.current > 0;

        return () => {
            if (released) return;
            released = true;
            keyboardRetentionCountRef.current = Math.max(0, keyboardRetentionCountRef.current - 1);
            isKeyboardLiftRetained.value = keyboardRetentionCountRef.current > 0;
            if (keyboardRetentionCountRef.current === 0 && lastKeyboardEventHeightAbsolute.value === 0) {
                isInteractiveDismissActive.value = false;
                keyboardHeightAbsolute.value = 0;
                keyboardHeightLive.value = 0;
                keyboardHeightForInset.value = 0;
                keyboardProgress.value = 0;
            }
            recomputeStaticLayout();
        };
    }, [
        isInteractiveDismissActive,
        isKeyboardLiftRetained,
        keyboardHeightAbsolute,
        keyboardHeightForInset,
        keyboardHeightLive,
        keyboardProgress,
        lastKeyboardEventHeightAbsolute,
        recomputeStaticLayout,
    ]);

    const setComposerMeasuredHeight = React.useCallback((height: number) => {
        const nextHeight = typeof height === 'number' && Number.isFinite(height) ? Math.max(0, Math.round(height)) : 0;
        if (composerHeight.value === nextHeight) return;
        composerHeight.value = nextHeight;
        recomputeStaticLayout();
    }, [composerHeight, recomputeStaticLayout]);

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
