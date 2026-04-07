import { describe, expect, it } from 'vitest';

import { buildSessionComposerNextMessageMetaOverridesFromUiState } from './registryUiBehavior';

describe('buildSessionComposerNextMessageMetaOverridesFromUiState', () => {
    it('adds Claude reasoning effort from session config-option overrides while preserving existing meta', () => {
        expect(buildSessionComposerNextMessageMetaOverridesFromUiState({
            agentId: 'claude',
            configOptionOverrides: {
                v: 1,
                updatedAt: 12,
                overrides: {
                    reasoning_effort: {
                        updatedAt: 12,
                        value: 'low',
                    },
                },
            },
            metaOverrides: {
                happier: {
                    kind: 'attachments.v1',
                    payload: { attachments: [] },
                },
            },
        })).toEqual({
            happier: {
                kind: 'attachments.v1',
                payload: { attachments: [] },
            },
            reasoningEffort: 'low',
        });
    });

    it('leaves non-Claude sessions unchanged', () => {
        const metaOverrides = {
            happier: {
                kind: 'participant_message.v1',
                payload: { recipient: { kind: 'agent_team_member' } },
            },
        };

        expect(buildSessionComposerNextMessageMetaOverridesFromUiState({
            agentId: 'codex',
            configOptionOverrides: {
                v: 1,
                updatedAt: 12,
                overrides: {
                    reasoning_effort: {
                        updatedAt: 12,
                        value: 'low',
                    },
                },
            },
            metaOverrides,
        })).toBe(metaOverrides);
    });
});
