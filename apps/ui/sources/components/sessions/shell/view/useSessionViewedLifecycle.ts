import { useFocusEffect } from '@react-navigation/native';
import * as React from 'react';

import {
    clearActiveViewingSessionId,
    markSessionHidden,
    markSessionVisible,
    setActiveViewingSessionId,
} from '@/sync/domains/session/activeViewingSession';
import {
    beginSessionViewingActivation,
    clearManualUnreadHold,
    endSessionViewingActivation,
    shouldSuppressAutomaticMarkViewed,
} from '@/sync/domains/session/readState/sessionManualUnreadHold';
import { sync } from '@/sync/sync';
import { fireAndForget } from '@/utils/system/fireAndForget';
import { runAfterInteractionsWithFallback } from '@/utils/timing/runAfterInteractionsWithFallback';

const SESSION_VIEWED_SEQ_CHANGE_MARK_DELAY_MS = 250;

export type UseSessionViewedLifecycleInput = Readonly<{
    sessionId: string;
    surfaceFocused: boolean;
    visibleReadSeq: number | null;
}>;

function normalizeVisibleReadSeq(value: number | null): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    return Math.max(0, Math.trunc(value));
}

export function useSessionViewedLifecycle(input: UseSessionViewedLifecycleInput): void {
    const isFocusedRef = React.useRef(false);
    const viewingActivationIdRef = React.useRef<number | null>(null);
    const markViewedTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    const lastMarkedRef = React.useRef<{ sessionSeq: number } | null>(null);
    const visibleReadSeqRef = React.useRef<number | null>(null);
    visibleReadSeqRef.current = normalizeVisibleReadSeq(input.visibleReadSeq);

    const clearDelayedMark = React.useCallback(() => {
        if (markViewedTimeoutRef.current) {
            clearTimeout(markViewedTimeoutRef.current);
            markViewedTimeoutRef.current = null;
        }
    }, []);

    const markSessionViewed = React.useCallback((opts: { sessionSeq: number; activationId: number | null }) => {
        const sessionSeq = normalizeVisibleReadSeq(opts.sessionSeq);
        if (sessionSeq === null) return;
        if (shouldSuppressAutomaticMarkViewed({
            sessionId: input.sessionId,
            sessionSeq,
            activationId: opts.activationId,
        })) {
            return;
        }
        fireAndForget(
            sync.markSessionViewed(input.sessionId, { sessionSeq }).then(() => {
                clearManualUnreadHold({ sessionId: input.sessionId, activationId: opts.activationId });
            }),
            { tag: 'SessionView.markSessionViewed' },
        );
    }, [input.sessionId]);

    React.useLayoutEffect(() => {
        if (!input.surfaceFocused) return;
        markSessionVisible(input.sessionId);
        return () => {
            markSessionHidden(input.sessionId);
        };
    }, [input.sessionId, input.surfaceFocused]);

    useFocusEffect(React.useCallback(() => {
        if (!input.surfaceFocused) return;

        isFocusedRef.current = true;
        const activationId = beginSessionViewingActivation(input.sessionId);
        viewingActivationIdRef.current = activationId;
        setActiveViewingSessionId(input.sessionId, activationId);

        const initialVisibleSeq = visibleReadSeqRef.current;
        lastMarkedRef.current = initialVisibleSeq === null ? null : { sessionSeq: initialVisibleSeq };
        const cancelInitialMark = initialVisibleSeq === null
            ? () => {}
            : runAfterInteractionsWithFallback(() => {
                markSessionViewed({ sessionSeq: initialVisibleSeq, activationId });
            });

        return () => {
            isFocusedRef.current = false;
            cancelInitialMark();
            clearDelayedMark();

            const blurVisibleSeq = visibleReadSeqRef.current;
            clearActiveViewingSessionId(input.sessionId, activationId);
            if (blurVisibleSeq !== null && !shouldSuppressAutomaticMarkViewed({
                sessionId: input.sessionId,
                sessionSeq: blurVisibleSeq,
                activationId,
            })) {
                runAfterInteractionsWithFallback(() => {
                    markSessionViewed({ sessionSeq: blurVisibleSeq, activationId });
                });
            }

            endSessionViewingActivation(input.sessionId, activationId);
            if (viewingActivationIdRef.current === activationId) {
                viewingActivationIdRef.current = null;
            }
        };
    }, [clearDelayedMark, input.sessionId, input.surfaceFocused, markSessionViewed]));

    React.useEffect(() => {
        if (!input.surfaceFocused || !isFocusedRef.current) return;

        const visibleReadSeq = normalizeVisibleReadSeq(input.visibleReadSeq);
        if (visibleReadSeq === null) return;

        const last = lastMarkedRef.current;
        if (last && last.sessionSeq >= visibleReadSeq) return;
        if (shouldSuppressAutomaticMarkViewed({
            sessionId: input.sessionId,
            sessionSeq: visibleReadSeq,
            activationId: viewingActivationIdRef.current,
        })) {
            return;
        }

        lastMarkedRef.current = { sessionSeq: visibleReadSeq };
        clearDelayedMark();
        const activationId = viewingActivationIdRef.current;
        markViewedTimeoutRef.current = setTimeout(() => {
            markViewedTimeoutRef.current = null;
            markSessionViewed({ sessionSeq: visibleReadSeq, activationId });
        }, SESSION_VIEWED_SEQ_CHANGE_MARK_DELAY_MS);

        return clearDelayedMark;
    }, [clearDelayedMark, input.sessionId, input.surfaceFocused, input.visibleReadSeq, markSessionViewed]);
}
