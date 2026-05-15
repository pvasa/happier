import { describe, expect, it } from 'vitest';

import type { SessionListRenderableSession } from '../../domains/session/listing/sessionListRenderable';
import {
    planSessionListRenderablePatches,
    planSessionListRenderableReplacement,
} from './sessionListRenderableStoreUpdate';

function makeRenderable(
    id: string,
    overrides: Partial<SessionListRenderableSession> = {},
): SessionListRenderableSession {
    return {
        id,
        seq: 1,
        createdAt: 1,
        updatedAt: 1,
        active: false,
        activeAt: 1,
        archivedAt: null,
        metadataVersion: 1,
        agentStateVersion: 0,
        metadata: null,
        thinking: false,
        thinkingAt: 0,
        presence: 'online',
        ...overrides,
    };
}

describe('sessionListRenderableStoreUpdate', () => {
    it('does not rebuild list data for attention-only replacement changes when attention promotion is disabled', () => {
        const previous = makeRenderable('s1', { latestReadyEventSeq: null });
        const plan = planSessionListRenderableReplacement({
            previousRenderables: { s1: previous },
            incomingRenderables: [{ ...previous, latestReadyEventSeq: 4 }],
            isSessionListViewDataUninitialized: false,
            rebuildOnAttentionPromotionFieldsChange: false,
        });

        expect(plan.needsSessionListViewDataRebuild).toBe(false);
        expect(plan.attentionPromotionFieldChangeCount).toBe(1);
    });

    it('rebuilds list data for attention-only replacement changes when attention promotion is enabled', () => {
        const previous = makeRenderable('s1', { latestReadyEventSeq: null });
        const plan = planSessionListRenderableReplacement({
            previousRenderables: { s1: previous },
            incomingRenderables: [{ ...previous, latestReadyEventSeq: 4 }],
            isSessionListViewDataUninitialized: false,
            rebuildOnAttentionPromotionFieldsChange: true,
        });

        expect(plan.needsSessionListViewDataRebuild).toBe(true);
        expect(plan.attentionPromotionFieldChangeCount).toBe(1);
    });

    it('rebuilds list data for attention-only patch changes when attention promotion is enabled', () => {
        const previous = makeRenderable('s1', { hasPendingUserActionRequests: false });
        const plan = planSessionListRenderablePatches({
            previousRenderables: { s1: previous },
            patches: [{ sessionId: 's1', patch: { hasPendingUserActionRequests: true } }],
            isSessionListViewDataUninitialized: false,
            rebuildOnAttentionPromotionFieldsChange: true,
        });

        expect(plan.needsSessionListViewDataRebuild).toBe(true);
        expect(plan.attentionPromotionFieldChangeCount).toBe(1);
    });
});
