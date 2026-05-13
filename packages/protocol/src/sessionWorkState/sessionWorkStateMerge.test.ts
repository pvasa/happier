import { describe, expect, it } from 'vitest';

import { mergeSessionWorkStateMetadataV1, mergeSessionWorkStateV1 } from './sessionWorkStateMerge.js';

function readRecord(value: unknown): Record<string, unknown> {
    expect(value).toBeTruthy();
    expect(typeof value).toBe('object');
    expect(Array.isArray(value)).toBe(false);
    return value as Record<string, unknown>;
}

describe('mergeSessionWorkStateV1', () => {
    it('replaces owned item families while preserving unknown items and fields', () => {
        const merged = mergeSessionWorkStateV1({
            existing: {
                v: 1,
                backendId: 'codex',
                updatedAt: 10,
                unknownRoot: true,
                primaryItemId: 'goal:old',
                items: [
                    {
                        id: 'goal:old',
                        kind: 'goal',
                        origin: 'vendor',
                        status: 'active',
                        title: 'Old goal',
                        backendId: 'codex',
                        updatedAt: 10,
                        oldField: 'remove with owned item',
                    },
                    {
                        id: 'future:item',
                        kind: 'milestone',
                        origin: 'future',
                        status: 'waiting',
                        title: 'Future item',
                        updatedAt: 10,
                        futureField: 'preserve',
                    },
                    {
                        id: 'todo:remote',
                        kind: 'todo',
                        origin: 'vendor',
                        status: 'pending',
                        title: 'Remote todo',
                        backendId: 'opencode',
                        updatedAt: 10,
                        remoteField: 'preserve',
                    },
                ],
            },
            nextOwned: {
                v: 1,
                backendId: 'codex',
                updatedAt: 20,
                primaryItemId: 'goal:new',
                items: [
                    {
                        id: 'goal:new',
                        kind: 'goal',
                        origin: 'vendor',
                        status: 'paused',
                        title: 'New goal',
                        backendId: 'codex',
                        updatedAt: 20,
                    },
                ],
            },
            ownedItemIdPrefixes: ['goal:'],
        });

        expect(merged.updatedAt).toBe(20);
        expect(merged.primaryItemId).toBe('goal:new');
        expect(readRecord(merged).unknownRoot).toBe(true);
        expect(merged.items.map((item) => readRecord(item).id)).toEqual(['future:item', 'todo:remote', 'goal:new']);
        expect(readRecord(merged.items[0]).futureField).toBe('preserve');
        expect(readRecord(merged.items[1]).remoteField).toBe('preserve');
        expect(merged.items.some((item) => readRecord(item).id === 'goal:old')).toBe(false);
    });

    it('merges an owned snapshot into session metadata through the canonical metadata key', () => {
        const next = mergeSessionWorkStateMetadataV1({
            metadata: {
                existing: 'keep',
                sessionWorkStateV1: {
                    v: 1,
                    backendId: 'codex',
                    updatedAt: 1,
                    futureSnapshotField: 'keep',
                    items: [
                        {
                            id: 'future:1',
                            kind: 'milestone',
                            origin: 'future',
                            status: 'waiting',
                            title: 'Future item',
                            updatedAt: 1,
                            futureField: { keep: true },
                        },
                        {
                            id: 'todo:opencode:old',
                            kind: 'todo',
                            origin: 'vendor',
                            status: 'pending',
                            title: 'Old todo',
                            updatedAt: 1,
                        },
                    ],
                },
            },
            nextOwned: {
                v: 1,
                backendId: 'opencode',
                updatedAt: 2,
                primaryItemId: 'todo:opencode:new',
                items: [
                    {
                        id: 'todo:opencode:new',
                        kind: 'todo',
                        origin: 'vendor',
                        status: 'active',
                        title: 'New todo',
                        backendId: 'opencode',
                        updatedAt: 2,
                    },
                ],
            },
            ownedSourceFamilies: ['todo:opencode'],
        });

        expect(next.existing).toBe('keep');
        expect(next.sessionWorkStateV1.items.map((item) => readRecord(item).id)).toEqual(['future:1', 'todo:opencode:new']);
        expect(readRecord(next.sessionWorkStateV1.items[0]).futureField).toEqual({ keep: true });
        expect(readRecord(next.sessionWorkStateV1).futureSnapshotField).toBe('keep');
        expect(next.sessionWorkStateV1.primaryItemId).toBe('todo:opencode:new');
    });
});
