import type { MachineDisplayRenderable } from '../../domains/machines/machineDisplayRenderable';
import type { SessionListViewItem } from '../../domains/session/listing/sessionListViewData';
import {
    didSessionListRenderableStructuralFieldsChange,
    type SessionListRenderableSession,
} from '../../domains/session/listing/sessionListRenderable';
import {
    normalizeSessionListAttentionPromotionMode,
    normalizeSessionListWorkingPlacementMode,
    type SessionListAttentionPromotionMode,
    type SessionListWorkingPlacementMode,
} from '../../domains/session/listing/attentionPromotion/sessionListAttentionPromotionTypes';
import type { WorkspacePathDisplayModeV1 } from '../../domains/session/listing/sessionWorkspacePresentation';
import type { Machine, Session } from '../../domains/state/storageTypes';
import {
    buildSessionListViewDataWithServerScope,
} from '../buildSessionListViewDataWithServerScope';
import {
    getActiveServerIdForSessionListCache,
    setActiveServerSessionListCache,
    setServerSessionListCache,
} from '../sessionListCache';
import { areServerProfileIdentifiersEquivalent } from '../../domains/server/serverProfiles';

import {
    planSessionListRenderableMerge,
    planSessionListRenderablePatches,
    planSessionListRenderableReplacement,
    type SessionListRenderablePatch,
    type SessionListRenderableStoreUpdatePlan,
} from './sessionListRenderableStoreUpdate';

type SessionListRenderableCommitSettings = Readonly<{
    groupInactiveSessionsByProject?: boolean;
    sessionListActiveGroupingV1?: 'project' | 'date';
    sessionListInactiveGroupingV1?: 'project' | 'date';
    sessionListSectionModeV1?: 'activity' | 'single';
    sessionListAttentionPromotionModeV1?: SessionListAttentionPromotionMode;
    sessionListWorkingPlacementModeV1?: SessionListWorkingPlacementMode;
    workspacePathDisplayModeV1?: WorkspacePathDisplayModeV1 | null;
}>;

type ProjectLookupResult = {
    key?: {
        machineId?: string | null;
        path?: string | null;
    } | null;
} | null;

export type SessionListRenderableCommitState = Readonly<{
    sessions: Record<string, Session>;
    sessionListRenderables: Record<string, SessionListRenderableSession>;
    sessionListViewData: SessionListViewItem[] | null;
    sessionListViewDataByServerId: Record<string, SessionListViewItem[] | null>;
    machines: Record<string, Machine>;
    machineDisplayById: Record<string, MachineDisplayRenderable>;
    settings: SessionListRenderableCommitSettings;
    getProjectForSession?: (sessionId: string) => ProjectLookupResult;
}>;

type MeasureListRebuild = (compute: () => SessionListViewItem[]) => SessionListViewItem[];

function normalizeTargetServerId(serverId: string | null | undefined): string | null {
    const normalized = String(serverId ?? '').trim();
    return normalized.length > 0 ? normalized : null;
}

function resolveSessionListGroupingForSettings(
    section: 'active' | 'inactive',
    settings: SessionListRenderableCommitSettings,
): 'project' | 'date' {
    if (section === 'active') {
        return settings.sessionListActiveGroupingV1 ?? 'project';
    }
    if (settings.sessionListInactiveGroupingV1) {
        return settings.sessionListInactiveGroupingV1;
    }
    return settings.groupInactiveSessionsByProject === true ? 'project' : 'date';
}

function isSessionListDateGroupingForRenderable(
    session: SessionListRenderableSession,
    settings: SessionListRenderableCommitSettings,
): boolean {
    if (settings.sessionListSectionModeV1 === 'single') {
        return resolveSessionListGroupingForSettings('active', settings) === 'date';
    }
    const section = session.active === true ? 'active' : 'inactive';
    return resolveSessionListGroupingForSettings(section, settings) === 'date';
}

export function didSessionListRenderableListViewFieldsChangeForSettings(
    previous: SessionListRenderableSession | undefined,
    next: SessionListRenderableSession,
    settings: SessionListRenderableCommitSettings,
): boolean {
    if (didSessionListRenderableStructuralFieldsChange(previous, next)) {
        return true;
    }
    if (!previous || previous.updatedAt === next.updatedAt) {
        return false;
    }
    return isSessionListDateGroupingForRenderable(previous, settings)
        || isSessionListDateGroupingForRenderable(next, settings);
}

export function shouldRebuildOnSessionPlacementFieldsChange(settings: SessionListRenderableCommitSettings): boolean {
    return normalizeSessionListAttentionPromotionMode(settings.sessionListAttentionPromotionModeV1) !== 'off'
        || normalizeSessionListWorkingPlacementMode(settings.sessionListWorkingPlacementModeV1) !== 'off';
}

export function buildSessionListViewDataForRenderableState(
    state: SessionListRenderableCommitState,
    options?: Readonly<{ serverId?: string | null }>,
): SessionListViewItem[] {
    return buildSessionListViewDataWithServerScope({
        sessions: state.sessionListRenderables,
        sessionRecords: state.sessions,
        machines: state.machineDisplayById,
        machineRecords: state.machines,
        serverId: options?.serverId,
        groupInactiveSessionsByProject: state.settings.groupInactiveSessionsByProject === true,
        activeGroupingV1: state.settings.sessionListActiveGroupingV1,
        inactiveGroupingV1: state.settings.sessionListInactiveGroupingV1,
        sectionModeV1: state.settings.sessionListSectionModeV1,
        workspacePathDisplayModeV1: state.settings.workspacePathDisplayModeV1,
        getProjectForSession: state.getProjectForSession,
    });
}

export function planSessionListRenderableReplacementCommit(input: Readonly<{
    state: SessionListRenderableCommitState;
    incomingRenderables: ReadonlyArray<SessionListRenderableSession>;
}>): SessionListRenderableStoreUpdatePlan {
    return planSessionListRenderableReplacement({
        previousRenderables: input.state.sessionListRenderables ?? {},
        incomingRenderables: input.incomingRenderables,
        isSessionListViewDataUninitialized: input.state.sessionListViewData === null,
        rebuildOnAttentionPromotionFieldsChange:
            shouldRebuildOnSessionPlacementFieldsChange(input.state.settings),
        didListViewFieldsChange: (previous, next) =>
            didSessionListRenderableListViewFieldsChangeForSettings(previous, next, input.state.settings),
    });
}

export function planSessionListRenderableMergeCommit(input: Readonly<{
    state: SessionListRenderableCommitState;
    incomingRenderables: ReadonlyArray<SessionListRenderableSession>;
}>): SessionListRenderableStoreUpdatePlan {
    return planSessionListRenderableMerge({
        previousRenderables: input.state.sessionListRenderables ?? {},
        incomingRenderables: input.incomingRenderables,
        isSessionListViewDataUninitialized: input.state.sessionListViewData === null,
        rebuildOnAttentionPromotionFieldsChange:
            shouldRebuildOnSessionPlacementFieldsChange(input.state.settings),
        didListViewFieldsChange: (previous, next) =>
            didSessionListRenderableListViewFieldsChangeForSettings(previous, next, input.state.settings),
    });
}

export function planSessionListRenderablePatchesCommit(input: Readonly<{
    state: SessionListRenderableCommitState;
    patches: ReadonlyArray<SessionListRenderablePatch>;
}>): SessionListRenderableStoreUpdatePlan {
    return planSessionListRenderablePatches({
        previousRenderables: input.state.sessionListRenderables ?? {},
        patches: input.patches,
        isSessionListViewDataUninitialized: input.state.sessionListViewData === null,
        rebuildOnAttentionPromotionFieldsChange:
            shouldRebuildOnSessionPlacementFieldsChange(input.state.settings),
        didListViewFieldsChange: (previous, next) =>
            didSessionListRenderableListViewFieldsChangeForSettings(previous, next, input.state.settings),
    });
}

export function applySessionListRenderableCommitPlan<S extends SessionListRenderableCommitState>(input: Readonly<{
    state: S;
    plan: SessionListRenderableStoreUpdatePlan;
    targetServerId?: string | null;
    measureListRebuild?: MeasureListRebuild;
}>): S {
    if (input.plan.noop) {
        return input.state;
    }

    const nextStateBase = {
        ...input.state,
        sessionListRenderables: input.plan.nextRenderables,
    };
    const targetServerId = normalizeTargetServerId(input.targetServerId);
    const activeServerId = getActiveServerIdForSessionListCache();
    const shouldUpdateActiveView = targetServerId === null
        || areServerProfileIdentifiersEquivalent(targetServerId, activeServerId);
    const build = () => buildSessionListViewDataForRenderableState(nextStateBase, {
        serverId: targetServerId,
    });
    const sessionListViewData = input.plan.needsSessionListViewDataRebuild
        ? input.measureListRebuild
            ? input.measureListRebuild(build)
            : build()
        : input.state.sessionListViewData;

    return {
        ...nextStateBase,
        sessionListViewData: shouldUpdateActiveView ? sessionListViewData : input.state.sessionListViewData,
        sessionListViewDataByServerId: input.plan.needsSessionListViewDataRebuild && sessionListViewData
            ? targetServerId
                ? setServerSessionListCache(
                    input.state.sessionListViewDataByServerId,
                    targetServerId,
                    sessionListViewData,
                )
                : setActiveServerSessionListCache(
                    input.state.sessionListViewDataByServerId,
                    sessionListViewData,
                )
            : input.state.sessionListViewDataByServerId,
    };
}
