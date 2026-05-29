import { z } from 'zod';

import {
  ConnectedServiceAuthGroupIdSchema,
  ConnectedServiceIdSchema,
  ConnectedServiceProfileIdSchema,
} from '../connect/connectedServiceSchemas.js';

export const SESSION_USAGE_LIMIT_RECOVERY_STATE_FIELD_ID = 'runtime.usageLimitRecovery' as const;
export const SESSION_USAGE_LIMIT_RECOVERY_METADATA_KEY = 'sessionUsageLimitRecoveryV1' as const;

const SessionUsageLimitRecoveryProfileAuthSelectionV1Schema = z
  .object({
    kind: z.literal('profile'),
    serviceId: ConnectedServiceIdSchema,
    profileId: ConnectedServiceProfileIdSchema,
  })
  .strict();

const SessionUsageLimitRecoveryGroupAuthSelectionV1Schema = z
  .object({
    kind: z.literal('group'),
    serviceId: ConnectedServiceIdSchema,
    groupId: ConnectedServiceAuthGroupIdSchema,
    profileId: ConnectedServiceProfileIdSchema,
  })
  .strict();

const SessionUsageLimitRecoveryNativeAuthSelectionV1Schema = z
  .object({
    kind: z.literal('native'),
    serviceId: ConnectedServiceIdSchema.nullable().optional(),
  })
  .strict();

export const SessionUsageLimitRecoveryAuthSelectionV1Schema = z.discriminatedUnion('kind', [
  SessionUsageLimitRecoveryNativeAuthSelectionV1Schema,
  SessionUsageLimitRecoveryProfileAuthSelectionV1Schema,
  SessionUsageLimitRecoveryGroupAuthSelectionV1Schema,
]);

export type SessionUsageLimitRecoveryAuthSelectionV1 =
  z.infer<typeof SessionUsageLimitRecoveryAuthSelectionV1Schema>;

export const SessionUsageLimitRecoveryV1Schema = z
  .object({
    v: z.literal(1),
    status: z.enum(['armed', 'waiting', 'checking', 'paused', 'exhausted', 'cancelled']),
    issueFingerprint: z.string().trim().min(1),
    armedAtMs: z.number().int().nonnegative(),
    resetAtMs: z.number().int().nonnegative().nullable(),
    nextCheckAtMs: z.number().int().nonnegative().nullable(),
    attemptCount: z.number().int().nonnegative(),
    maxAttempts: z.number().int().nonnegative(),
    lastProbeError: z.string().trim().min(1).nullable(),
    selectedAuth: SessionUsageLimitRecoveryAuthSelectionV1Schema,
  })
  .strict();

export type SessionUsageLimitRecoveryV1 = z.infer<typeof SessionUsageLimitRecoveryV1Schema>;
