import * as React from 'react';
import { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';
import { Text } from '@/components/ui/text/Text';

import { useNewSessionAgentAuthoringOptionsState } from './useNewSessionAgentAuthoringOptionsState';

type PersistedDraft = Readonly<{
    modelId?: string | null;
    acpSessionModeId?: string | null;
    sessionConfigOptionOverrides?: Readonly<{
        v: 1;
        updatedAt: number;
        overrides: Readonly<Record<string, Readonly<{ updatedAt: number; value: string }>>>;
    }> | null;
}>;

let latestSetAcpConfigOptionOverride: ((configId: string, value: string) => void) | null = null;

function HookProbe(props: Readonly<{ persistedDraft: PersistedDraft | null }>) {
    const state = useNewSessionAgentAuthoringOptionsState({
        agentType: 'claude',
        hydratedTempAuthoringDraft: null,
        hydratedPersistedAuthoringDraft: props.persistedDraft,
    });
    latestSetAcpConfigOptionOverride = state.setAcpConfigOptionOverride;

    return (
        <>
            <Text testID="overrides-json">
                {JSON.stringify(state.sessionConfigOptionOverrides)}
            </Text>
        </>
    );
}

describe('useNewSessionAgentAuthoringOptionsState', () => {
    it('does not issue an extra commit when equal session config overrides are re-passed with a fresh object', async () => {
        const commitPhases: string[] = [];
        const persistedDraft: PersistedDraft = {
            modelId: 'default',
            acpSessionModeId: 'default',
            sessionConfigOptionOverrides: {
                v: 1,
                updatedAt: 123,
                overrides: {
                    service_tier: {
                        updatedAt: 123,
                        value: 'fast',
                    },
                },
            },
        };

        const screen = await renderScreen(
            <React.Profiler
                id="HookProbe"
                onRender={(_id, phase) => {
                    commitPhases.push(phase);
                }}
            >
                <HookProbe persistedDraft={persistedDraft} />
            </React.Profiler>,
        );

        commitPhases.length = 0;

        await screen.update(
            <React.Profiler
                id="HookProbe"
                onRender={(_id, phase) => {
                    commitPhases.push(phase);
                }}
            >
                <HookProbe
                    persistedDraft={{
                        modelId: 'default',
                        acpSessionModeId: 'default',
                        sessionConfigOptionOverrides: {
                            v: 1,
                            updatedAt: 123,
                            overrides: {
                                service_tier: {
                                    updatedAt: 123,
                                    value: 'fast',
                                },
                            },
                        },
                    }}
                />
            </React.Profiler>,
        );

        expect(commitPhases).toEqual(['update']);
        expect(screen.findByTestId('overrides-json')?.props.children).toContain('"service_tier"');
    });

    it('does not rewrite override metadata when the same value is selected again', async () => {
        const nowSpy = vi.spyOn(Date, 'now');
        nowSpy.mockReturnValue(200);

        try {
            const screen = await renderScreen(<HookProbe
                persistedDraft={{
                    modelId: 'default',
                    acpSessionModeId: 'default',
                    sessionConfigOptionOverrides: {
                        v: 1,
                        updatedAt: 100,
                        overrides: {
                            service_tier: {
                                updatedAt: 100,
                                value: 'fast',
                            },
                        },
                    },
                }}
            />);

            const firstJson = screen.findByTestId('overrides-json')?.props.children;

            await act(async () => {
                latestSetAcpConfigOptionOverride?.('service_tier', 'fast');
            });

            const secondJson = screen.findByTestId('overrides-json')?.props.children;

            expect(secondJson).toBe(firstJson);
        } finally {
            nowSpy.mockRestore();
        }
    });
});
