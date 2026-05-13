import { describe, expect, it } from 'vitest';

import { resolveAgentUiBehaviorFromFlavor, supportsEditableSessionGoals } from './registryUiBehavior';
import type { Session } from '@/sync/domains/state/storageTypes';

function createRegistryBehaviorSession(metadata: Session['metadata']): Session {
    return {
        id: 's1',
        seq: 1,
        createdAt: 1,
        updatedAt: 1,
        active: true,
        activeAt: 1,
        metadata,
        metadataVersion: 1,
        agentState: null,
        agentStateVersion: 1,
        thinking: false,
        thinkingAt: 0,
        presence: 'online',
    };
}

describe('resolveAgentUiBehaviorFromFlavor', () => {
    it('resolves provider behavior through shared flavor aliases', () => {
        const behavior = resolveAgentUiBehaviorFromFlavor('open-code');

        expect(behavior?.directSessions?.browse?.getSourceOptions).toBeTypeOf('function');
    });

    it('keeps codex-specific permission footer overrides on the native codex agent', () => {
        const behavior = resolveAgentUiBehaviorFromFlavor('codex');

        expect(behavior?.permissions?.footer?.stopHandling).toBe('denyOnly');
        expect(behavior?.permissions?.footer?.supportsExecPolicyAmendment).toBe(true);
        expect(behavior?.sessionUsage?.supportsExactContextUsageBadge).toBe(false);
    });

    it('exposes editable goals only for codex app-server sessions', () => {
        expect(supportsEditableSessionGoals({
            agentId: 'codex',
            session: createRegistryBehaviorSession({
                flavor: 'codex',
                path: '/repo',
                host: 'host',
                codexBackendMode: 'appServer',
            }),
        })).toBe(true);

        expect(supportsEditableSessionGoals({
            agentId: 'codex',
            session: createRegistryBehaviorSession({
                flavor: 'codex',
                path: '/repo',
                host: 'host',
                codexBackendMode: 'acp',
            }),
        })).toBe(false);
    });

    it('uses the generic codex-decision footer behavior for opencode-family flavors', () => {
        const behavior = resolveAgentUiBehaviorFromFlavor('open-code');

        expect(behavior?.permissions?.footer?.stopHandling).toBe('denyAndAbortRun');
        expect(behavior?.permissions?.footer?.supportsExecPolicyAmendment).toBe(false);
        expect(behavior?.sessionUsage?.supportsExactContextUsageBadge).toBe(true);
    });
});
