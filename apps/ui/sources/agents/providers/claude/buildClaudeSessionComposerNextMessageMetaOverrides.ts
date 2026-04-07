import type { AcpConfigOptionOverridesV1 } from '@happier-dev/protocol';

function normalizeReasoningEffort(raw: unknown): string | null {
    if (typeof raw !== 'string') return null;
    const trimmed = raw.trim().toLowerCase();
    return trimmed.length > 0 ? trimmed : null;
}

export function buildClaudeSessionComposerNextMessageMetaOverrides(params: Readonly<{
    configOptionOverrides: AcpConfigOptionOverridesV1 | null | undefined;
    metaOverrides?: Record<string, unknown>;
}>): Record<string, unknown> | undefined {
    const merged = params.metaOverrides ? { ...params.metaOverrides } : undefined;
    const reasoningEffort = normalizeReasoningEffort(params.configOptionOverrides?.overrides?.reasoning_effort?.value);
    if (!reasoningEffort) {
        return merged;
    }

    return {
        ...(merged ?? {}),
        reasoningEffort,
    };
}
