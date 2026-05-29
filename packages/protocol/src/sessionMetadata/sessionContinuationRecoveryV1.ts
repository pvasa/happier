import { z } from 'zod';

export const SESSION_CONTINUATION_RECOVERY_METADATA_KEY = 'sessionContinuationRecoveryV1' as const;

export const SessionContinuationResumePromptModeV1Schema = z.enum(['standard', 'off']);
export type SessionContinuationResumePromptModeV1 =
  z.infer<typeof SessionContinuationResumePromptModeV1Schema>;

export const SessionContinuationRecoveryAttemptStatusV1Schema = z.enum([
  'pending_provider_context',
  'sending',
  'sent',
  'suppressed_newer_user_input',
  'retry_required',
  'continuity_failed',
]);
export type SessionContinuationRecoveryAttemptStatusV1 =
  z.infer<typeof SessionContinuationRecoveryAttemptStatusV1Schema>;

export const SessionContinuationRecoveryAttemptV1Schema = z
  .object({
    v: z.literal(1),
    attemptId: z.string().trim().min(1),
    status: SessionContinuationRecoveryAttemptStatusV1Schema,
    failureAtMs: z.number().int().nonnegative(),
    updatedAtMs: z.number().int().nonnegative(),
    resumePromptMode: SessionContinuationResumePromptModeV1Schema,
    sentAtMs: z.number().int().nonnegative().optional(),
    errorCode: z.string().trim().min(1).optional(),
  })
  .strict();
export type SessionContinuationRecoveryAttemptV1 =
  z.infer<typeof SessionContinuationRecoveryAttemptV1Schema>;

export const SessionContinuationRecoveryV1Schema = z
  .object({
    v: z.literal(1),
    attemptsById: z.record(z.string().trim().min(1), SessionContinuationRecoveryAttemptV1Schema),
  })
  .strict();
export type SessionContinuationRecoveryV1 = z.infer<typeof SessionContinuationRecoveryV1Schema>;

const blockingStatuses = new Set<SessionContinuationRecoveryAttemptStatusV1>([
  'pending_provider_context',
  'sending',
]);

export function isSessionContinuationRecoveryBlockingPendingDrain(metadata: unknown): boolean {
  const recovery = readSessionContinuationRecoveryFromMetadata(metadata);
  if (!recovery) return false;
  return Object.values(recovery.attemptsById).some((attempt) => blockingStatuses.has(attempt.status));
}

export function readSessionContinuationRecoveryFromMetadata(metadata: unknown): SessionContinuationRecoveryV1 | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const recovery = (metadata as Record<string, unknown>)[SESSION_CONTINUATION_RECOVERY_METADATA_KEY];
  const parsed = SessionContinuationRecoveryV1Schema.safeParse(recovery);
  return parsed.success ? parsed.data : null;
}
