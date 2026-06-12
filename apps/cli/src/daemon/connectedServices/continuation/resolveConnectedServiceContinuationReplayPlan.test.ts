import { describe, expect, it } from 'vitest';

import {
  resolveConnectedServiceContinuationReplayPlan,
  shouldReleaseConnectedServiceRestartBoundaryForReplayPlan,
} from './resolveConnectedServiceContinuationReplayPlan';

describe('resolveConnectedServiceContinuationReplayPlan', () => {
  it('suppresses continuation for pre-turn group policy switches', () => {
    expect(resolveConnectedServiceContinuationReplayPlan({
      switchReason: 'pre_turn_group_policy',
      hasProviderActivityThisTurn: false,
    })).toEqual({
      continuationRequired: false,
      replayMode: 'suppress',
    });
  });

  it('uses a continuation prompt when provider activity evidence is ambiguous after daemon-local state is lost', () => {
    expect(resolveConnectedServiceContinuationReplayPlan({
      switchReason: 'automatic_runtime_failure',
      hasProviderActivityThisTurn: false,
    })).toEqual({
      continuationRequired: true,
      replayMode: 'continuation_prompt',
    });
  });

  it('uses a continuation prompt when the interrupted turn lacks durable no-activity evidence', () => {
    expect(resolveConnectedServiceContinuationReplayPlan({
      switchReason: 'automatic_runtime_failure',
      hasProviderActivityThisTurn: false,
    })).toEqual({
      continuationRequired: true,
      replayMode: 'continuation_prompt',
    });
  });

  it('retries the original user message only when durable transcript evidence proves no provider activity', () => {
    expect(resolveConnectedServiceContinuationReplayPlan({
      switchReason: 'automatic_runtime_failure',
      hasProviderActivityThisTurn: false,
      providerActivityEvidence: 'no_activity_found',
    })).toEqual({
      continuationRequired: true,
      replayMode: 'retry_original_user_message',
    });
  });

  it('uses a continuation prompt when durable transcript evidence found provider activity despite a missing daemon-local flag', () => {
    expect(resolveConnectedServiceContinuationReplayPlan({
      switchReason: 'automatic_runtime_failure',
      hasProviderActivityThisTurn: false,
      providerActivityEvidence: 'activity_found',
    })).toEqual({
      continuationRequired: true,
      replayMode: 'continuation_prompt',
    });
  });

  it('uses a continuation prompt for a completed provider turn even after the daemon-local queue goes idle', () => {
    expect(resolveConnectedServiceContinuationReplayPlan({
      switchReason: 'automatic_runtime_failure',
      hasProviderActivityThisTurn: true,
    })).toEqual({
      continuationRequired: true,
      replayMode: 'continuation_prompt',
    });
  });

  it('uses a continuation prompt when the interrupted turn already had provider activity', () => {
    expect(resolveConnectedServiceContinuationReplayPlan({
      switchReason: 'automatic_runtime_failure',
      hasProviderActivityThisTurn: true,
    })).toEqual({
      continuationRequired: true,
      replayMode: 'continuation_prompt',
    });
  });

  it('releases the old turn boundary for continuation and guarded original retry plans', () => {
    expect(shouldReleaseConnectedServiceRestartBoundaryForReplayPlan({
      continuationRequired: true,
      replayMode: 'continuation_prompt',
    })).toBe(true);
    expect(shouldReleaseConnectedServiceRestartBoundaryForReplayPlan({
      continuationRequired: true,
      replayMode: 'retry_original_user_message',
    })).toBe(true);
    expect(shouldReleaseConnectedServiceRestartBoundaryForReplayPlan({
      continuationRequired: false,
      replayMode: 'suppress',
    })).toBe(false);
  });
});
