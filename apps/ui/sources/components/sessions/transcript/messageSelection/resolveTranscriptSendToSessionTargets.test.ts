import { describe, expect, it } from 'vitest';

import { resolveTranscriptSendToSessionTargets, type TranscriptSendToSessionTargetCandidate } from './resolveTranscriptSendToSessionTargets';

function candidate(input: Partial<TranscriptSendToSessionTargetCandidate> & Pick<TranscriptSendToSessionTargetCandidate, 'id'>): TranscriptSendToSessionTargetCandidate {
    return {
        id: input.id,
        serverId: input.serverId ?? 'server-a',
        accessLevel: input.accessLevel,
        metadata: input.metadata ?? {},
        meaningfulActivityAt: input.meaningfulActivityAt ?? null,
        updatedAt: input.updatedAt ?? 0,
        createdAt: input.createdAt ?? 0,
    };
}

describe('resolveTranscriptSendToSessionTargets', () => {
    it('keeps only same-server writable user-facing destination sessions and excludes the source session', () => {
        const targets = resolveTranscriptSendToSessionTargets({
            sourceSessionId: 'source',
            sourceServerId: 'server-a',
            sessions: [
                candidate({ id: 'source', updatedAt: 50 }),
                candidate({ id: 'writable-edit', accessLevel: 'edit', updatedAt: 40 }),
                candidate({ id: 'writable-owner', accessLevel: undefined, updatedAt: 30 }),
                candidate({ id: 'read-only', accessLevel: 'view', updatedAt: 20 }),
                candidate({ id: 'other-server', serverId: 'server-b', updatedAt: 10 }),
                candidate({ id: 'hidden', metadata: { hiddenSystemSession: true }, updatedAt: 60 }),
            ],
        });

        expect(targets.map((target) => target.id)).toEqual(['writable-edit', 'writable-owner']);
    });

    it('orders destinations by the same stable updated buckets as the session list', () => {
        const fiveMinuteBucketMs = 5 * 60_000;
        const targets = resolveTranscriptSendToSessionTargets({
            sourceSessionId: 'source',
            sourceServerId: 'server-a',
            sessions: [
                candidate({ id: 'older-bucket', meaningfulActivityAt: fiveMinuteBucketMs * 9, updatedAt: 10_000, createdAt: 300 }),
                candidate({ id: 'newer-created', meaningfulActivityAt: fiveMinuteBucketMs * 10 + 1, updatedAt: 100, createdAt: 200 }),
                candidate({ id: 'older-created', meaningfulActivityAt: fiveMinuteBucketMs * 10 + 120_000, updatedAt: 10_100, createdAt: 100 }),
                candidate({ id: 'created-fallback', updatedAt: 0, createdAt: fiveMinuteBucketMs * 11 }),
            ],
        });

        expect(targets.map((target) => target.id)).toEqual([
            'created-fallback',
            'newer-created',
            'older-created',
            'older-bucket',
        ]);
    });
});
