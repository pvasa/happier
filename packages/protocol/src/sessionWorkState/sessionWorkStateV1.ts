import { z } from 'zod';

export const SessionWorkStateStatusV1Schema = z.enum([
  'pending',
  'active',
  'paused',
  'blocked',
  'complete',
  'cancelled',
  'unknown',
]);
export type SessionWorkStateStatusV1 = z.infer<typeof SessionWorkStateStatusV1Schema>;

export const SessionWorkStateItemKindV1Schema = z.enum(['goal', 'task', 'todo']);
export type SessionWorkStateItemKindV1 = z.infer<typeof SessionWorkStateItemKindV1Schema>;

export const SessionWorkStateItemOriginV1Schema = z.enum(['vendor', 'happier', 'derived']);
export type SessionWorkStateItemOriginV1 = z.infer<typeof SessionWorkStateItemOriginV1Schema>;

export const SessionWorkStateItemV1Schema = z
  .object({
    id: z.string().min(1),
    kind: SessionWorkStateItemKindV1Schema,
    origin: SessionWorkStateItemOriginV1Schema,
    status: SessionWorkStateStatusV1Schema,
    title: z.string().trim().min(1).max(4000),
    summary: z.string().trim().max(8000).optional(),
    backendId: z.string().min(1).optional(),
    agentId: z.string().min(1).optional(),
    vendorRef: z.string().min(1).optional(),
    order: z.number().int().nonnegative().optional(),
    parentId: z.string().min(1).optional(),
    priority: z.string().optional(),
    progress: z.number().finite().min(0).max(1).optional(),
    tokenBudget: z.number().finite().positive().nullable().optional(),
    tokensUsed: z.number().int().nonnegative().optional(),
    timeUsedSeconds: z.number().finite().nonnegative().optional(),
    createdAt: z.number().int().nonnegative().optional(),
    startedAt: z.number().int().nonnegative().optional(),
    completedAt: z.number().int().nonnegative().optional(),
    updatedAt: z.number().int().nonnegative(),
  })
  .passthrough();
export type SessionWorkStateItemV1 = z.infer<typeof SessionWorkStateItemV1Schema>;

export const SessionWorkStateTruncationV1Schema = z
  .object({
    reason: z.enum(['item_limit', 'provider_limit']),
    omittedCount: z.number().int().nonnegative().optional(),
  })
  .passthrough();
export type SessionWorkStateTruncationV1 = z.infer<typeof SessionWorkStateTruncationV1Schema>;

export const SessionWorkStateV1Schema = z
  .object({
    v: z.literal(1),
    backendId: z.string().min(1),
    agentId: z.string().min(1).optional(),
    updatedAt: z.number().int().nonnegative(),
    items: z.array(SessionWorkStateItemV1Schema),
    primaryItemId: z.string().min(1).nullable().optional(),
    truncated: SessionWorkStateTruncationV1Schema.optional(),
  })
  .passthrough();
export type SessionWorkStateV1 = z.infer<typeof SessionWorkStateV1Schema>;

export type SessionWorkStateUnknownItemV1 = Readonly<Record<string, unknown>>;
export type SessionWorkStateWriteItemV1 = SessionWorkStateItemV1 | SessionWorkStateUnknownItemV1;
export type SessionWorkStateWriteSnapshotV1 = Omit<SessionWorkStateV1, 'items'> &
  Readonly<{ items: readonly SessionWorkStateWriteItemV1[] }>;
