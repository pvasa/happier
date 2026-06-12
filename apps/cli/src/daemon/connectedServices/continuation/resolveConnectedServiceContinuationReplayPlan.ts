import type { SessionContinuationReplayModeV1 } from '@happier-dev/protocol';
import type { ConnectedServiceSessionAuthSwitchReason } from '../runtimeAuth/connectedServiceSessionAuthSwitchCore';

export type ConnectedServiceContinuationReplayPlan = Readonly<{
  continuationRequired?: boolean;
  replayMode: SessionContinuationReplayModeV1;
}>;

export function shouldReleaseConnectedServiceRestartBoundaryForReplayPlan(
  plan: ConnectedServiceContinuationReplayPlan,
): boolean {
  return plan.continuationRequired !== false && plan.replayMode !== 'suppress';
}

export function resolveConnectedServiceContinuationReplayPlan(input: Readonly<{
  switchReason?: ConnectedServiceSessionAuthSwitchReason;
  hasProviderActivityThisTurn: boolean;
  providerActivityEvidence?: 'activity_found' | 'no_activity_found' | 'unknown';
}>): ConnectedServiceContinuationReplayPlan {
  if (input.switchReason === 'pre_turn_group_policy') {
    return {
      continuationRequired: false,
      replayMode: 'suppress',
    };
  }

  if (input.hasProviderActivityThisTurn || input.providerActivityEvidence === 'activity_found') {
    return {
      continuationRequired: true,
      replayMode: 'continuation_prompt',
    };
  }

  // The daemon-local deferral queue is best-effort process state and is wiped by
  // restarts. Only durable transcript evidence may authorize replaying the
  // original committed user prompt.
  if (input.providerActivityEvidence === 'no_activity_found') {
    return {
      continuationRequired: true,
      replayMode: 'retry_original_user_message',
    };
  }

  return {
    continuationRequired: true,
    replayMode: 'continuation_prompt',
  };
}
