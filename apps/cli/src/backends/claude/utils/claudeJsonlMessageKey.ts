import { randomUUID } from 'node:crypto';

import { RawJSONLinesSchema, type RawJSONLines } from '../types';

export const CLAUDE_JSONL_LOCAL_ID_PREFIX = 'claude-jsonl:';

function readTrimmedString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readClaudeJsonlRawId(body: RawJSONLines): string | null {
  if (body.type === 'summary') {
    return readTrimmedString((body as Record<string, unknown>).leafUuid);
  }
  return readTrimmedString((body as Record<string, unknown>).uuid);
}

export function buildClaudeJsonlMessageKey(body: RawJSONLines): string | null {
  const rawId = readClaudeJsonlRawId(body);
  if (!rawId) return null;
  const sidechainId = readTrimmedString((body as Record<string, unknown>).sidechainId);
  return `${sidechainId ?? 'main'}:${body.type}:${rawId}`;
}

export function buildClaudeJsonlLocalId(body: RawJSONLines): string {
  const key = buildClaudeJsonlMessageKey(body);
  return key ? `${CLAUDE_JSONL_LOCAL_ID_PREFIX}${key}` : randomUUID();
}

export function extractClaudeJsonlMessageKeyFromLocalId(localId: string | null | undefined): string | null {
  const trimmed = readTrimmedString(localId);
  if (!trimmed?.startsWith(CLAUDE_JSONL_LOCAL_ID_PREFIX)) return null;
  const key = trimmed.slice(CLAUDE_JSONL_LOCAL_ID_PREFIX.length);
  return key.length > 0 ? key : null;
}

export function extractClaudeJsonlMessageKeyFromSessionContent(content: unknown): string | null {
  if (!content || typeof content !== 'object' || Array.isArray(content)) return null;
  const record = content as Record<string, unknown>;
  if (record.role !== 'agent') return null;
  const body = record.content;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const bodyRecord = body as Record<string, unknown>;
  if (bodyRecord.type !== 'output') return null;
  const parsed = RawJSONLinesSchema.safeParse(bodyRecord.data);
  return parsed.success ? buildClaudeJsonlMessageKey(parsed.data) : null;
}
