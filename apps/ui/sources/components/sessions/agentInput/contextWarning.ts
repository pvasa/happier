import type { Theme } from '@/theme';
import { t } from '@/text';

import { toContextWarningWindowTokens } from './resolveContextWarningWindowTokens';

export type ContextUsageSeverity = 'neutral' | 'warning' | 'critical';

export type ContextUsageState = Readonly<{
    contextWindowTokens: number;
    warningWindowTokens: number;
    usedTokens: number;
    usedRatio: number;
    usedPercentage: number;
    remainingWarningPercentage: number;
    severity: ContextUsageSeverity;
}>;

function normalizeContextWindowTokens(raw: number | null | undefined): number | null {
    return typeof raw === 'number' && Number.isFinite(raw) && raw > 0
        ? Math.trunc(raw)
        : null;
}

function trimTrailingZero(value: string): string {
    return value.endsWith('.0') ? value.slice(0, -2) : value;
}

export function formatContextUsagePercent(value: number): string {
    const safeValue = Number.isFinite(value) ? Math.max(0, value) : 0;
    return `${trimTrailingZero(safeValue.toFixed(1))}%`;
}

export function formatContextTokenCount(value: number): string {
    const safeValue = Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
    if (safeValue >= 1_000_000) {
        return `${trimTrailingZero((safeValue / 1_000_000).toFixed(safeValue >= 10_000_000 ? 0 : 1))}M`;
    }
    if (safeValue >= 1_000) {
        return `${trimTrailingZero((safeValue / 1_000).toFixed(safeValue >= 100_000 ? 0 : 1))}k`;
    }
    return String(safeValue);
}

export function getContextUsageState(
    contextSize: number,
    alwaysShow: boolean = false,
    contextWindowTokens: number | null = null,
): ContextUsageState | null {
    const safeContextWindowTokens = normalizeContextWindowTokens(contextWindowTokens);
    if (safeContextWindowTokens === null) return null;
    const safeContextSize = Number.isFinite(contextSize) ? Math.max(0, contextSize) : 0;
    const warningWindowTokens = toContextWarningWindowTokens(safeContextWindowTokens);
    const usedRatio = safeContextSize / safeContextWindowTokens;
    const usedPercentage = usedRatio * 100;
    const warningPercentageUsed = (safeContextSize / warningWindowTokens) * 100;
    const remainingWarningPercentage = Math.max(0, Math.min(100, 100 - warningPercentageUsed));

    const severity: ContextUsageSeverity =
        remainingWarningPercentage <= 5
            ? 'critical'
            : remainingWarningPercentage <= 10
                ? 'warning'
                : 'neutral';

    if (!alwaysShow && severity === 'neutral') return null;

    return {
        contextWindowTokens: safeContextWindowTokens,
        warningWindowTokens,
        usedTokens: safeContextSize,
        usedRatio,
        usedPercentage,
        remainingWarningPercentage,
        severity,
    };
}

export function getContextWarning(
    contextSize: number,
    alwaysShow: boolean = false,
    theme: Theme,
    maxContextSize: number | null = null,
) {
    const usageState = getContextUsageState(contextSize, alwaysShow, maxContextSize);
    if (!usageState) return null;

    return {
        text: t('agentInput.context.remaining', { percent: Math.round(usageState.remainingWarningPercentage) }),
        color:
            usageState.severity === 'critical'
                ? theme.colors.state.danger.foreground
                : usageState.severity === 'warning'
                    ? theme.colors.state.neutral.foreground
                    : theme.colors.text.secondary,
    };
}
