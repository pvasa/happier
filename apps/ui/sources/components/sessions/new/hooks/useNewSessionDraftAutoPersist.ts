import * as React from 'react';
import { InteractionManager, Platform } from 'react-native';

import {
    TEXT_INPUT_LARGE_TEXT_CHANGE_DEBOUNCE_MS,
    WEB_TEXTAREA_AUTOSIZE_VALUE_LENGTH_LIMIT,
} from '@/components/ui/forms/largeTextInputPolicy';

const NEW_SESSION_DRAFT_AUTOPERSIST_DELAY_MS = {
    native: 3000,
    web: 250,
} as const;

type RequestIdleCallback = (
    callback: IdleRequestCallback,
    options?: IdleRequestOptions,
) => number;

type CancelIdleCallback = (handle: number) => void;

function isLargeWebDraftTextLength(length: number | undefined): boolean {
    return typeof length === 'number'
        && Number.isFinite(length)
        && length > WEB_TEXTAREA_AUTOSIZE_VALUE_LENGTH_LIMIT;
}

function resolveNewSessionDraftAutoPersistDelayMs(params: Readonly<{
    draftTextLength?: number;
}>): number {
    if (Platform.OS === 'web' && isLargeWebDraftTextLength(params.draftTextLength)) {
        return Math.max(
            TEXT_INPUT_LARGE_TEXT_CHANGE_DEBOUNCE_MS,
            NEW_SESSION_DRAFT_AUTOPERSIST_DELAY_MS.web,
        );
    }
    return Platform.OS === 'web'
        ? NEW_SESSION_DRAFT_AUTOPERSIST_DELAY_MS.web
        : NEW_SESSION_DRAFT_AUTOPERSIST_DELAY_MS.native;
}

function scheduleWebIdlePersist(callback: () => void): () => void {
    let cancelled = false;
    const runIfCurrent = () => {
        if (cancelled) return;
        callback();
    };
    const idleGlobal = globalThis as typeof globalThis & {
        requestIdleCallback?: RequestIdleCallback;
        cancelIdleCallback?: CancelIdleCallback;
    };
    if (typeof idleGlobal.requestIdleCallback === 'function') {
        const idleHandle = idleGlobal.requestIdleCallback(() => {
            runIfCurrent();
        }, { timeout: TEXT_INPUT_LARGE_TEXT_CHANGE_DEBOUNCE_MS });
        return () => {
            cancelled = true;
            idleGlobal.cancelIdleCallback?.(idleHandle);
        };
    }
    const timeoutHandle = setTimeout(runIfCurrent, 0);
    return () => {
        cancelled = true;
        clearTimeout(timeoutHandle);
    };
}

export function useNewSessionDraftAutoPersist(params: Readonly<{
    persistDraftNow: () => void;
    persistenceEnabled?: boolean;
    draftTextLength?: number;
}>): void {
    // Persist the current wizard state so it survives remounts and screen navigation
    // Uses debouncing to avoid excessive writes
    const draftSaveTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    const cancelIdlePersistRef = React.useRef<(() => void) | null>(null);
    const persistDraftNowRef = React.useRef(params.persistDraftNow);
    const persistenceEnabledRef = React.useRef(params.persistenceEnabled ?? true);
    const draftTextLengthRef = React.useRef(params.draftTextLength);
    React.useEffect(() => {
        persistDraftNowRef.current = params.persistDraftNow;
    }, [params.persistDraftNow]);
    React.useEffect(() => {
        persistenceEnabledRef.current = params.persistenceEnabled ?? true;
    }, [params.persistenceEnabled]);
    React.useEffect(() => {
        draftTextLengthRef.current = params.draftTextLength;
    }, [params.draftTextLength]);

    const cancelPendingIdlePersist = React.useCallback(() => {
        cancelIdlePersistRef.current?.();
        cancelIdlePersistRef.current = null;
    }, []);

    const persistAfterCurrentPolicy = React.useCallback(() => {
        cancelPendingIdlePersist();
        if (!persistenceEnabledRef.current) {
            return;
        }
        if (Platform.OS === 'web' && isLargeWebDraftTextLength(draftTextLengthRef.current)) {
            let cancelCurrentIdlePersist: (() => void) | null = null;
            cancelCurrentIdlePersist = scheduleWebIdlePersist(() => {
                if (cancelIdlePersistRef.current === cancelCurrentIdlePersist) {
                    cancelIdlePersistRef.current = null;
                }
                if (!persistenceEnabledRef.current) {
                    return;
                }
                persistDraftNowRef.current();
            });
            cancelIdlePersistRef.current = cancelCurrentIdlePersist;
            return;
        }
        // Persisting uses synchronous storage under the hood (MMKV), which can block the JS thread on iOS.
        // Run after interactions so taps/animations stay responsive.
        if (Platform.OS === 'web') {
            persistDraftNowRef.current();
        } else {
            InteractionManager.runAfterInteractions(() => {
                persistDraftNowRef.current();
            });
        }
    }, [cancelPendingIdlePersist]);

    React.useEffect(() => {
        cancelPendingIdlePersist();
        if (draftSaveTimerRef.current !== null) {
            clearTimeout(draftSaveTimerRef.current);
            draftSaveTimerRef.current = null;
        }
        if ((params.persistenceEnabled ?? true) !== true) {
            return;
        }
        const delayMs = resolveNewSessionDraftAutoPersistDelayMs({
            draftTextLength: params.draftTextLength,
        });
        draftSaveTimerRef.current = setTimeout(() => {
            draftSaveTimerRef.current = null;
            persistAfterCurrentPolicy();
        }, delayMs);
        return () => {
            if (draftSaveTimerRef.current !== null) {
                clearTimeout(draftSaveTimerRef.current);
            }
        };
    }, [cancelPendingIdlePersist, params.draftTextLength, params.persistDraftNow, params.persistenceEnabled, persistAfterCurrentPolicy]);

    // Flush pending work on unmount so fast navigation / modal close doesn't drop draft state.
    React.useEffect(() => {
        return () => {
            if (draftSaveTimerRef.current === null) {
                return;
            }
            clearTimeout(draftSaveTimerRef.current);
            draftSaveTimerRef.current = null;
            if (!persistenceEnabledRef.current) {
                return;
            }
            persistAfterCurrentPolicy();
        };
    }, [persistAfterCurrentPolicy]);
}
