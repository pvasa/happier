import { describe, expect, it } from 'vitest';

import { lightTheme } from '@/theme';

import {
    formatContextTokenCount,
    formatContextUsagePercent,
    getContextUsageState,
    getContextWarning,
} from './contextWarning';
import {
    resolveContextWarningWindowTokens,
    resolveContextWindowTokens,
} from './resolveContextWarningWindowTokens';

describe('context warning window resolution', () => {
    it('returns null for non-Claude providers when no supported context window is known', () => {
        expect(resolveContextWindowTokens({
            agentId: 'codex',
            metadata: null,
        } as any)).toBeNull();
    });

    it('uses dynamic model context-window metadata for non-Claude providers when resolving the actual window size', () => {
        expect(resolveContextWindowTokens({
            agentId: 'codex',
            metadata: {
                sessionModelsV1: {
                    v: 1,
                    provider: 'codex',
                    updatedAt: 1,
                    currentModelId: 'gpt-5.4',
                    availableModels: [
                        {
                            id: 'gpt-5.4',
                            name: 'GPT 5.4',
                            contextWindowTokens: 400_000,
                        },
                    ],
                },
            } as any,
        })).toBe(400_000);
    });

    it('prefers live usage telemetry over metadata when resolving the actual window size', () => {
        expect(resolveContextWindowTokens({
            agentId: 'codex',
            metadata: null,
            usageData: {
                inputTokens: 700,
                outputTokens: 250,
                cacheCreation: 0,
                cacheRead: 200,
                contextSize: 1_200,
                contextWindowTokens: 258_400,
            },
        } as any)).toBe(258_400);
    });

    it('uses dynamic model context-window metadata for non-Claude providers', () => {
        expect(resolveContextWarningWindowTokens({
            agentId: 'codex',
            metadata: {
                sessionModelsV1: {
                    v: 1,
                    provider: 'codex',
                    updatedAt: 1,
                    currentModelId: 'gpt-5.4',
                    availableModels: [
                        {
                            id: 'gpt-5.4',
                            name: 'GPT 5.4',
                            contextWindowTokens: 400_000,
                        },
                    ],
                },
            } as any,
        })).toBe(380_000);
    });

    it('uses the 1M warning window when Claude is explicitly set to a [1m] model override', () => {
        expect(resolveContextWarningWindowTokens({
            agentId: 'claude',
            metadata: {
                modelOverrideV1: {
                    v: 1,
                    updatedAt: 1,
                    modelId: 'sonnet[1m]',
                },
            } as any,
        })).toBe(950_000);
    });

    it('uses the 1M warning window when Claude session state reports a [1m] current model', () => {
        expect(resolveContextWarningWindowTokens({
            agentId: 'claude',
            metadata: {
                sessionModelsV1: {
                    v: 1,
                    provider: 'claude',
                    updatedAt: 1,
                    currentModelId: 'claude-sonnet-4-6[1m]',
                    availableModels: [],
                },
            } as any,
        })).toBe(950_000);
    });

    it('uses the 1M warning window when the active Claude model description reports a 1 million context window', () => {
        expect(resolveContextWarningWindowTokens({
            agentId: 'claude',
            metadata: {
                sessionModelsV1: {
                    v: 1,
                    provider: 'claude',
                    updatedAt: 1,
                    currentModelId: 'claude-opus-4-6',
                    availableModels: [
                        {
                            id: 'claude-opus-4-6',
                            name: 'Opus 4.6',
                            description: '1 million token context window',
                        },
                    ],
                },
            } as any,
        })).toBe(950_000);
    });

    it('keeps the legacy warning window for non-1M models', () => {
        expect(resolveContextWarningWindowTokens({
            agentId: 'claude',
            metadata: {
                modelOverrideV1: {
                    v: 1,
                    updatedAt: 1,
                    modelId: 'claude-sonnet-4-6',
                },
            } as any,
        })).toBe(190_000);
    });
});

describe('getContextWarning', () => {
    it('keeps always-visible 1M usage in a neutral tone when the session is not near the warning threshold', () => {
        const usageState = getContextUsageState(200_000, true, 1_000_000);
        expect(usageState?.severity).toBe('neutral');
        expect(formatContextUsagePercent(usageState?.usedPercentage ?? 0)).toBe('20%');
        expect(formatContextTokenCount(usageState?.usedTokens ?? 0)).toBe('200k');

        const warning = getContextWarning(200_000, true, lightTheme, 1_000_000);
        expect(warning?.color).toBe(lightTheme.colors.text.secondary);
        expect(warning?.text).toContain('79');
    });
});
