import { z } from 'zod';

import {
  ConnectedServiceIdSchema,
  type ConnectedServiceId,
} from '../connect/connectedServiceBindings.js';

export const CONNECTED_SERVICE_QUOTA_REFS_METADATA_KEY = 'connectedServiceQuotaRefsV1' as const;
export const CONNECTED_SERVICE_QUOTA_REFS_MAX_REFS = 16;

export const ConnectedServiceQuotaRefV1Schema = z
  .object({
    v: z.literal(1),
    serviceId: ConnectedServiceIdSchema,
    profileId: z.string().trim().min(1),
  })
  .strict();
export type ConnectedServiceQuotaRefV1 = z.infer<typeof ConnectedServiceQuotaRefV1Schema>;

export const ConnectedServiceQuotaRefsV1Schema = z
  .object({
    v: z.literal(1),
    refs: z.array(ConnectedServiceQuotaRefV1Schema).max(CONNECTED_SERVICE_QUOTA_REFS_MAX_REFS),
    updatedAtMs: z.number().int().nonnegative(),
  })
  .strict();
export type ConnectedServiceQuotaRefsV1 = z.infer<typeof ConnectedServiceQuotaRefsV1Schema>;

function toMetadataRecord(metadata: unknown): Record<string, unknown> {
  return metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? { ...(metadata as Record<string, unknown>) }
    : {};
}

function normalizeTimestampMs(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

function readRawRefs(metadata: unknown): unknown[] {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return [];
  const raw = (metadata as Record<string, unknown>)[CONNECTED_SERVICE_QUOTA_REFS_METADATA_KEY];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
  const refs = (raw as { refs?: unknown }).refs;
  return Array.isArray(refs) ? refs : [];
}

export function normalizeConnectedServiceQuotaRefs(
  refs: ReadonlyArray<unknown>,
): ConnectedServiceQuotaRefV1[] {
  const normalized: ConnectedServiceQuotaRefV1[] = [];
  const seen = new Set<string>();
  for (const rawRef of refs) {
    const parsed = ConnectedServiceQuotaRefV1Schema.safeParse(rawRef);
    if (!parsed.success) continue;
    const key = `${parsed.data.serviceId}\0${parsed.data.profileId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(parsed.data);
  }
  return normalized.slice(-CONNECTED_SERVICE_QUOTA_REFS_MAX_REFS);
}

export function readConnectedServiceQuotaRefsFromMetadata(metadata: unknown): ConnectedServiceQuotaRefV1[] {
  return normalizeConnectedServiceQuotaRefs(readRawRefs(metadata));
}

export function writeConnectedServiceQuotaRefToMetadata(
  metadata: unknown,
  input: Readonly<{
    serviceId: ConnectedServiceId | string;
    profileId: string;
    updatedAtMs: number;
  }>,
): Record<string, unknown> {
  const parsedRef = ConnectedServiceQuotaRefV1Schema.safeParse({
    v: 1,
    serviceId: input.serviceId,
    profileId: input.profileId,
  });
  const base = toMetadataRecord(metadata);
  if (!parsedRef.success) return base;

  base[CONNECTED_SERVICE_QUOTA_REFS_METADATA_KEY] = {
    v: 1,
    refs: normalizeConnectedServiceQuotaRefs([
      ...readRawRefs(metadata),
      parsedRef.data,
    ]),
    updatedAtMs: normalizeTimestampMs(input.updatedAtMs),
  } satisfies ConnectedServiceQuotaRefsV1;
  return base;
}
