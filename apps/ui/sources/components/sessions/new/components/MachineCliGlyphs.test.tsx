import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { CapabilityDetectResult } from '@/sync/api/capabilities/capabilitiesProtocol';
import { renderScreen } from '@/dev/testkit';
import { installMachineComponentCommonModuleMocks } from '@/components/machines/machineComponentTestHelpers';
import { MachineCliGlyphs } from './MachineCliGlyphs';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

installMachineComponentCommonModuleMocks();

vi.mock('@/hooks/server/useDaemonScopedMachineCapabilitiesCache', () => ({
    useDaemonScopedMachineCapabilitiesCache: () => ({
        state: {
            status: 'loaded',
            snapshot: {
                response: {
                    protocolVersion: 1,
                    results: {
                        'cli.cursor': {
                            ok: true,
                            checkedAt: 1,
                            data: { available: true },
                        } satisfies CapabilityDetectResult,
                    },
                },
            },
        },
    }),
}));

vi.mock('@/sync/domains/state/storage', () => ({
    useMachine: () => ({ daemonStateVersion: 1 }),
}));

vi.mock('@/agents/hooks/useEnabledAgentIds', () => ({
    useEnabledAgentIds: () => ['cursor'],
}));

vi.mock('@/agents/catalog/catalog', () => ({
    AGENT_IDS: ['cursor'],
    getAgentCore: () => ({
        cli: { detectKey: 'cursor-agent' },
        ui: { cliGlyphScale: 1 },
    }),
    getAgentCliGlyph: () => 'C',
}));

describe('MachineCliGlyphs', () => {
    it('renders CLI glyphs from canonical provider capability ids', async () => {
        const tree = await renderScreen(React.createElement(MachineCliGlyphs, {
            machineId: 'machine-1',
            isOnline: true,
        }));

        expect(tree.findAllByType('Text').some((node) => node.props.children === 'C')).toBe(true);
    });
});
