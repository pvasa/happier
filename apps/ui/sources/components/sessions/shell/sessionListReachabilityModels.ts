import type { MachineDisplayRenderable } from '@/sync/domains/machines/machineDisplayRenderable';
import { resolveSessionWorkspacePresentation } from '@/sync/domains/session/listing/sessionWorkspacePresentation';
import type { SessionListViewItem } from '@/sync/domains/state/storage';
import { readDisplayMachineTargetForSession } from '@/sync/ops/sessionMachineTarget';
import { sessionTagKey } from './sessionTagUtils';

type SessionReachableDisplay = Readonly<{
    machineId: string | null;
    machineLabel: string;
    workspaceSubtitle: string;
    workspaceSubtitleEllipsizeMode: 'head' | 'tail';
}>;

export type SessionListReachabilityModels = Readonly<{
    reachableSessionDisplayByKey: Map<string, SessionReachableDisplay>;
    hasMultipleMachines: boolean;
}>;

const EMPTY_REACHABILITY_MODELS: SessionListReachabilityModels = {
    reachableSessionDisplayByKey: new Map<string, SessionReachableDisplay>(),
    hasMultipleMachines: false,
};

function resolveReachableDisplayRowKey(item: Extract<SessionListViewItem, { type: 'session' }>): string {
    const serverId = typeof item.serverId === 'string' ? item.serverId.trim() : '';
    const sessionId = String(item.session.id);
    return serverId ? sessionTagKey(serverId, sessionId) : sessionId;
}

export function buildSessionListReachabilityModels(input: Readonly<{
    items: ReadonlyArray<SessionListViewItem> | null | undefined;
    machinesById: Readonly<Record<string, MachineDisplayRenderable>>;
    workspaceLabelsV1: Readonly<Record<string, string>>;
}>): SessionListReachabilityModels {
    const items = input.items;
    if (!items || items.length === 0) {
        return EMPTY_REACHABILITY_MODELS;
    }

    const reachableSessionDisplayByKey = new Map<string, SessionReachableDisplay>();
    const machineIds = new Set<string>();

    for (const item of items) {
        if (item.type !== 'session') continue;
        const target = readDisplayMachineTargetForSession({
            sessionId: item.session.id,
            metadata: item.session?.metadata ?? null,
        });
        const workspace = resolveSessionWorkspacePresentation({
            metadata: item.session?.metadata ?? null,
            machines: input.machinesById,
            target,
            workspaceLabelsV1: input.workspaceLabelsV1,
        });

        reachableSessionDisplayByKey.set(resolveReachableDisplayRowKey(item), {
            machineId: workspace.machineId,
            machineLabel: workspace.machineLabel,
            workspaceSubtitle: workspace.displayTitle,
            workspaceSubtitleEllipsizeMode: workspace.hasCustomLabel ? 'tail' : 'head',
        });

        const machineKey = workspace.machineId ?? workspace.machineLabel ?? '';
        if (machineKey) machineIds.add(machineKey);
    }

    if (reachableSessionDisplayByKey.size === 0) {
        return EMPTY_REACHABILITY_MODELS;
    }

    return {
        reachableSessionDisplayByKey,
        hasMultipleMachines: machineIds.size > 1,
    };
}
