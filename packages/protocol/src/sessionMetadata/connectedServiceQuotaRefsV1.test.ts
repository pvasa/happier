import { describe, expect, it } from 'vitest';

import {
  SessionMetadataSchema,
  readConnectedServiceQuotaRefsFromMetadata,
  writeConnectedServiceQuotaRefToMetadata,
} from '../index.js';

describe('connected service quota refs session metadata', () => {
  it('writes sanitized quota snapshot refs into session metadata', () => {
    const metadata = writeConnectedServiceQuotaRefToMetadata({}, {
      serviceId: 'openai-codex',
      profileId: 'acct:native',
      updatedAtMs: 1_000,
    });

    expect(SessionMetadataSchema.safeParse(metadata).success).toBe(true);
    expect(readConnectedServiceQuotaRefsFromMetadata(metadata)).toEqual([{
      v: 1,
      serviceId: 'openai-codex',
      profileId: 'acct:native',
    }]);
  });

  it('deduplicates refs, ignores malformed refs, and keeps the newest bounded window', () => {
    const metadata = Array.from({ length: 20 }, (_, index) => ({
      serviceId: 'openai-codex',
      profileId: `native-${index}`,
    })).reduce<Record<string, unknown>>((acc, ref, index) => (
      writeConnectedServiceQuotaRefToMetadata(acc, {
        ...ref,
        updatedAtMs: 1_000 + index,
      })
    ), {
      connectedServiceQuotaRefsV1: {
        v: 1,
        refs: [
          { v: 1, serviceId: 'openai-codex', profileId: 'native-0' },
          { v: 1, serviceId: 'not-a-service', profileId: 'bad' },
        ],
        updatedAtMs: 500,
      },
    });

    const refs = readConnectedServiceQuotaRefsFromMetadata(metadata);
    expect(refs).toHaveLength(16);
    expect(refs[0]).toEqual({ v: 1, serviceId: 'openai-codex', profileId: 'native-4' });
    expect(refs.at(-1)).toEqual({ v: 1, serviceId: 'openai-codex', profileId: 'native-19' });
  });
});
