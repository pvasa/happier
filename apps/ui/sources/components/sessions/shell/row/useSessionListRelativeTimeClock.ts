import React from 'react';

const SESSION_LIST_RELATIVE_TIME_CLOCK_INTERVAL_MS = 60_000;

export function useSessionListRelativeTimeClock(): number {
    const [nowMs, setNowMs] = React.useState(() => Date.now());

    React.useEffect(() => {
        const intervalId = setInterval(() => {
            setNowMs(Date.now());
        }, SESSION_LIST_RELATIVE_TIME_CLOCK_INTERVAL_MS);
        return () => clearInterval(intervalId);
    }, []);

    return nowMs;
}

export function useSessionListRuntimeFreshnessClock(nextRuntimeFreshnessAtMs: number | null): number {
    const [nowMs, setNowMs] = React.useState(() => Date.now());

    React.useEffect(() => {
        if (nextRuntimeFreshnessAtMs === null) return undefined;
        const delayMs = Math.max(0, nextRuntimeFreshnessAtMs - Date.now());
        const timeoutId = setTimeout(() => {
            setNowMs(Date.now());
        }, delayMs);
        return () => clearTimeout(timeoutId);
    }, [nextRuntimeFreshnessAtMs]);

    return nowMs;
}
