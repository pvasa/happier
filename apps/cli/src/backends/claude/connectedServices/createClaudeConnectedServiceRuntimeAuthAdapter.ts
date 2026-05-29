import { classifyClaudeConnectedServiceRuntimeAuthFailure } from './classifyClaudeConnectedServiceRuntimeAuthFailure';
import { mapClaudeRateLimitEventToUsageDetails } from './mapClaudeRateLimitEventToUsageDetails';
import { resolveClaudeConnectedServiceRuntimeAuthSwitchPlan } from './claudeConnectedServiceRuntimeAuthSwitchPlan';
import type {
  ConnectedServiceProviderRuntimeAuthAdapter,
  ConnectedServiceRuntimeAuthTargetInput,
} from '@/daemon/connectedServices/runtimeAuth/types';
import type { ConnectedServiceCredentialRecordV1 } from '@happier-dev/protocol';

function readRecord(value: unknown): Record<string, unknown> | null {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function readCredentialRecord(input: ConnectedServiceRuntimeAuthTargetInput): ConnectedServiceCredentialRecordV1 | null {
  const selection = readRecord(input.selection);
  const record = readRecord(selection?.record);
  return record as ConnectedServiceCredentialRecordV1 | null;
}

export function createClaudeConnectedServiceRuntimeAuthAdapter(): ConnectedServiceProviderRuntimeAuthAdapter {
  return {
    classifyRuntimeAuthFailure(input) {
      const authClassification = classifyClaudeConnectedServiceRuntimeAuthFailure({
        error: input.error,
        selection: input.selection,
      });
      if (authClassification) return authClassification;

      const details = mapClaudeRateLimitEventToUsageDetails(input.error);
      return classifyClaudeConnectedServiceRuntimeAuthFailure({
        ...(details ? { details } : { error: input.error }),
        selection: input.selection,
      });
    },
    async materializeActiveProfile() {
      return { supported: true };
    },
    canHotApply() {
      return { supported: false, recovery: 'restart_rematerialize' };
    },
    async hotApply() {
      return { applied: false, reason: 'hot_apply_unsupported' };
    },
    async recoverAfterRuntimeAuthSwitch(input) {
      const record = readCredentialRecord(input);
      return {
        recovered: false,
        recovery: 'restart_rematerialize',
        ...(record ? { plan: resolveClaudeConnectedServiceRuntimeAuthSwitchPlan(record) } : {}),
      };
    },
    async probeQuota() {
      return { status: 'unsupported' };
    },
    async refreshActiveProfile() {
      return { status: 'unsupported' };
    },
  };
}
