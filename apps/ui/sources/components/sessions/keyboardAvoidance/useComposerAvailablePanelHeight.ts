import * as React from 'react';

import { useComposerKeyboardLayout } from './ComposerKeyboardContext';

const AVAILABLE_PANEL_HEIGHT_REACT_THROTTLE_MS = 120;

function normalizeAvailablePanelHeight(height: number | null | undefined): number | undefined {
    if (typeof height !== 'number' || !Number.isFinite(height) || height <= 0) {
        return undefined;
    }
    return Math.round(height);
}

export function useComposerAvailablePanelHeight(): number | undefined {
    const layout = useComposerKeyboardLayout();
    const [availablePanelHeight, setAvailablePanelHeight] = React.useState<number | undefined>(undefined);
    const lastCommitAtRef = React.useRef(0);
    const pendingTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    const pendingHeightRef = React.useRef<number | undefined>(availablePanelHeight);

    const commitHeight = React.useCallback((height: number | undefined) => {
        lastCommitAtRef.current = Date.now();
        pendingHeightRef.current = height;
        setAvailablePanelHeight((current) => (current === height ? current : height));
    }, []);

    const scheduleHeight = React.useCallback((height: number) => {
        const normalizedHeight = normalizeAvailablePanelHeight(height);
        pendingHeightRef.current = normalizedHeight;
        const elapsedMs = Date.now() - lastCommitAtRef.current;
        if (elapsedMs >= AVAILABLE_PANEL_HEIGHT_REACT_THROTTLE_MS) {
            if (pendingTimeoutRef.current) {
                clearTimeout(pendingTimeoutRef.current);
                pendingTimeoutRef.current = null;
            }
            commitHeight(normalizedHeight);
            return;
        }

        if (pendingTimeoutRef.current) return;
        pendingTimeoutRef.current = setTimeout(() => {
            pendingTimeoutRef.current = null;
            commitHeight(pendingHeightRef.current);
        }, AVAILABLE_PANEL_HEIGHT_REACT_THROTTLE_MS - elapsedMs);
    }, [commitHeight]);

    React.useEffect(() => {
        if (!layout) {
            commitHeight(undefined);
            return undefined;
        }

        return layout.subscribeAvailablePanelHeight?.(scheduleHeight);
    }, [commitHeight, layout, scheduleHeight]);

    React.useEffect(() => () => {
        if (pendingTimeoutRef.current) {
            clearTimeout(pendingTimeoutRef.current);
            pendingTimeoutRef.current = null;
        }
    }, []);

    return availablePanelHeight;
}
