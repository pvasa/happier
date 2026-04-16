import { asRecord, normalizeString } from './openCodeParsing';

const RENDERABLE_PART_TYPES = new Set(['text', 'step']);
const RUNTIME_RENDERABLE_PART_TYPES = new Set(['text', 'step', 'reasoning']);

export function extractOpenCodeRenderableTextFromPart(part: unknown): string {
  return extractOpenCodeRenderableTextForAllowedTypes(part, RENDERABLE_PART_TYPES);
}

export function extractOpenCodeRuntimeRenderableTextFromPart(part: unknown): string {
  return extractOpenCodeRenderableTextForAllowedTypes(part, RUNTIME_RENDERABLE_PART_TYPES);
}

function extractOpenCodeRenderableTextForAllowedTypes(part: unknown, allowedPartTypes: ReadonlySet<string>): string {
  const rec = asRecord(part);
  if (!rec) return '';

  const partType = normalizeString(rec.type).trim().toLowerCase();
  if (!allowedPartTypes.has(partType)) return '';

  const text = normalizeString(rec.text);
  return text.trim().length > 0 ? text : '';
}

export function extractOpenCodeRenderableTextFromParts(parts: unknown[]): string {
  const out: string[] = [];
  for (const part of parts) {
    const text = extractOpenCodeRenderableTextFromPart(part);
    if (!text) continue;
    out.push(text);
  }
  return out.join('').trim();
}
