import { describe, expect, it } from 'vitest';

import {
  SessionMetadataSchema,
  isSessionContinuationRecoveryBlockingPendingDrain,
} from '../index.js';

describe('sessionContinuationRecoveryV1', () => {
  it('registers continuation recovery metadata and blocks pending drain only for unresolved attempts', () => {
    const pendingMetadata = {
      sessionContinuationRecoveryV1: {
        v: 1,
        attemptsById: {
          'generation-1:restart-1': {
            v: 1,
            attemptId: 'generation-1:restart-1',
            status: 'pending_provider_context',
            failureAtMs: 1_000,
            updatedAtMs: 1_100,
            resumePromptMode: 'standard',
          },
        },
      },
    };

    expect(SessionMetadataSchema.safeParse(pendingMetadata).success).toBe(true);
    expect(isSessionContinuationRecoveryBlockingPendingDrain(pendingMetadata)).toBe(true);

    expect(isSessionContinuationRecoveryBlockingPendingDrain({
      sessionContinuationRecoveryV1: {
        v: 1,
        attemptsById: {
          'generation-1:restart-1': {
            v: 1,
            attemptId: 'generation-1:restart-1',
            status: 'awaiting_provider_activity',
            failureAtMs: 1_000,
            updatedAtMs: 1_200,
            sentAtMs: 1_200,
            resumePromptMode: 'standard',
            continuationRequired: true,
          },
        },
      },
    })).toBe(true);

    expect(isSessionContinuationRecoveryBlockingPendingDrain({
      sessionContinuationRecoveryV1: {
        v: 1,
        attemptsById: {
          'generation-1:restart-1': {
            v: 1,
            attemptId: 'generation-1:restart-1',
            status: 'provider_activity_observed',
            failureAtMs: 1_000,
            updatedAtMs: 1_300,
            sentAtMs: 1_200,
            resumePromptMode: 'standard',
            continuationRequired: true,
          },
        },
      },
    })).toBe(false);

    expect(isSessionContinuationRecoveryBlockingPendingDrain({
      sessionContinuationRecoveryV1: {
        v: 1,
        attemptsById: {
          'generation-1:restart-1': {
            v: 1,
            attemptId: 'generation-1:restart-1',
            status: 'provider_activity_timeout',
            failureAtMs: 1_000,
            updatedAtMs: 7_000,
            sentAtMs: 1_200,
            resumePromptMode: 'standard',
            continuationRequired: true,
            errorCode: 'provider_activity_timeout',
          },
        },
      },
    })).toBe(false);

    expect(isSessionContinuationRecoveryBlockingPendingDrain({
      sessionContinuationRecoveryV1: {
        v: 1,
        attemptsById: {
          'generation-1:restart-1': {
            v: 1,
            attemptId: 'generation-1:restart-1',
            status: 'suppressed_no_interrupted_turn',
            failureAtMs: 1_000,
            updatedAtMs: 1_300,
            resumePromptMode: 'standard',
            continuationRequired: false,
          },
        },
      },
    })).toBe(false);

    expect(isSessionContinuationRecoveryBlockingPendingDrain({
      sessionContinuationRecoveryV1: {
        v: 1,
        attemptsById: {
          'generation-1:restart-1': {
            v: 1,
            attemptId: 'generation-1:restart-1',
            status: 'sent',
            failureAtMs: 1_000,
            updatedAtMs: 1_200,
            sentAtMs: 1_200,
            resumePromptMode: 'standard',
          },
        },
      },
    })).toBe(false);

    expect(SessionMetadataSchema.safeParse({
      sessionContinuationRecoveryV1: {
        v: 1,
        attemptsById: {
          invalid: {
            v: 1,
            attemptId: 'invalid',
            status: 'sent',
            failureAtMs: -1,
            updatedAtMs: 1_200,
            resumePromptMode: 'standard',
          },
        },
      },
    }).success).toBe(false);
  });
});
