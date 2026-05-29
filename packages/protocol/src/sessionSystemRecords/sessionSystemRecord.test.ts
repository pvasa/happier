import { describe, expect, it } from 'vitest';

import * as protocol from '../index.js';

type SafeParseResult = Readonly<{ success: boolean; data?: unknown }>;
type ProtocolSchemaExport = Readonly<{ safeParse: (value: unknown) => SafeParseResult; parse: (value: unknown) => unknown }>;

function protocolSchema(name: string): ProtocolSchemaExport {
  const value = (protocol as Record<string, unknown>)[name];
  expect(value).toMatchObject({ safeParse: expect.any(Function), parse: expect.any(Function) });
  return value as ProtocolSchemaExport;
}

function validSummaryShardPayload() {
  return {
    v: 1,
    seqFrom: 10,
    seqTo: 25,
    createdAtFromMs: 1000,
    createdAtToMs: 2000,
    summary: 'We discussed memory search and shard indexing.',
    keywords: ['memory', 'search'],
    entities: ['Happier'],
    decisions: ['Store memory summaries outside the transcript.'],
  };
}

function validSynopsisPayload() {
  return {
    v: 1,
    seqTo: 25,
    updatedAtMs: 3000,
    synopsis: 'The session is moving memory records out of transcript messages.',
  };
}

function validRecord() {
  return {
    id: 'sysrec_1',
    sessionId: 'sess_1',
    namespace: 'memory',
    kind: 'summary_shard.v1',
    localId: 'memory:summary_shard:v1:10-25',
    content: { t: 'encrypted', c: 'ciphertext' },
    createdAt: '2026-05-19T12:00:00.000Z',
    updatedAt: '2026-05-19T12:01:00.000Z',
  };
}

describe('session system record protocol schemas', () => {
  it('accepts encrypted system-record upsert content for registered memory kinds', () => {
    const schema = protocolSchema('SessionSystemRecordUpsertRequestSchema');

    const parsed = schema.safeParse({
      namespace: 'memory',
      kind: 'summary_shard.v1',
      localId: 'memory:summary_shard:v1:10-25',
      content: { t: 'encrypted', c: 'ciphertext' },
    });

    expect(parsed.success).toBe(true);
  });

  it('accepts plain system-record upsert content for registered memory kinds', () => {
    const schema = protocolSchema('SessionSystemRecordUpsertRequestSchema');

    const parsed = schema.safeParse({
      namespace: 'memory',
      kind: 'synopsis.v1',
      localId: 'memory:synopsis:v1:25',
      content: { t: 'plain', v: validSynopsisPayload() },
    });

    expect(parsed.success).toBe(true);
  });

  it('rejects plain system-record upsert content that does not match the registered memory payload', () => {
    const schema = protocolSchema('SessionSystemRecordUpsertRequestSchema');

    expect(schema.safeParse({
      namespace: 'memory',
      kind: 'synopsis.v1',
      localId: 'memory:synopsis:v1:25',
      content: { t: 'plain', v: { anything: true } },
    }).success).toBe(false);
    expect(schema.safeParse({
      namespace: 'memory',
      kind: 'summary_shard.v1',
      localId: 'memory:summary_shard:v1:10-25',
      content: {
        t: 'plain',
        v: {
          ...validSummaryShardPayload(),
          seqFrom: 30,
        },
      },
    }).success).toBe(false);
  });

  it('rejects unregistered namespaces, kinds, and blank local ids', () => {
    const schema = protocolSchema('SessionSystemRecordUpsertRequestSchema');

    expect(schema.safeParse({
      namespace: 'search',
      kind: 'summary_shard.v1',
      localId: 'memory:summary_shard:v1:10-25',
      content: { t: 'encrypted', c: 'ciphertext' },
    }).success).toBe(false);
    expect(schema.safeParse({
      namespace: 'memory',
      kind: 'session_summary_shard.v1',
      localId: 'memory:summary_shard:v1:10-25',
      content: { t: 'encrypted', c: 'ciphertext' },
    }).success).toBe(false);
    expect(schema.safeParse({
      namespace: 'memory',
      kind: 'summary_shard.v1',
      localId: '   ',
      content: { t: 'encrypted', c: 'ciphertext' },
    }).success).toBe(false);
  });

  it('validates memory system-record payload contracts by kind', () => {
    const schema = protocolSchema('MemorySessionSystemRecordPayloadSchema');

    expect(schema.safeParse({
      kind: 'summary_shard.v1',
      payload: validSummaryShardPayload(),
    }).success).toBe(true);
    expect(schema.safeParse({
      kind: 'synopsis.v1',
      payload: validSynopsisPayload(),
    }).success).toBe(true);
    expect(schema.safeParse({
      kind: 'summary_shard.v1',
      payload: {
        ...validSummaryShardPayload(),
        seqFrom: 30,
      },
    }).success).toBe(false);
  });

  it('exports the generic system-record payload schema as raw plain-content payload values', () => {
    const schema = protocolSchema('SessionSystemRecordPayloadSchema');

    expect(schema.safeParse(validSummaryShardPayload()).success).toBe(true);
    expect(schema.safeParse(validSynopsisPayload()).success).toBe(true);
    expect(schema.safeParse({
      kind: 'synopsis.v1',
      payload: validSynopsisPayload(),
    }).success).toBe(false);
  });

  it('supports paginated list responses', () => {
    const schema = protocolSchema('SessionSystemRecordPageResponseSchema');

    const parsed = schema.safeParse({
      records: [validRecord()],
      nextCursor: 'cursor_2',
      hasNext: true,
    });

    expect(parsed.success).toBe(true);
  });

  it('supports latest-by-namespace-kind query and nullable response shapes', () => {
    const querySchema = protocolSchema('SessionSystemRecordLatestQuerySchema');
    const responseSchema = protocolSchema('SessionSystemRecordLatestResponseSchema');

    expect(querySchema.safeParse({
      namespace: 'memory',
      kind: 'synopsis.v1',
    }).success).toBe(true);
    expect(responseSchema.safeParse({
      record: {
        ...validRecord(),
        kind: 'synopsis.v1',
        localId: 'memory:synopsis:v1:25',
        content: { t: 'plain', v: validSynopsisPayload() },
      },
    }).success).toBe(true);
    expect(responseSchema.safeParse({ record: null }).success).toBe(true);
  });
});
