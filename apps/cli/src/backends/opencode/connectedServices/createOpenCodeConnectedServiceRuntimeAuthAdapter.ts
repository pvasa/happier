import { classifyOpenCodeUsageLimitError } from './classifyOpenCodeUsageLimitError';
import {
  findOpenCodeConnectedServiceSelection,
  readOpenCodeConnectedServiceId,
  resolveOpenCodeConnectedServiceSelectionByPrecedence,
} from './openCodeConnectedServicePrecedence';
import { releaseForAuthSwitch } from '@/backends/opencode/server/sharedManagedServer';
import type { ConnectedServiceProviderRuntimeAuthAdapter } from '@/daemon/connectedServices/runtimeAuth/types';

function readRecord(value: unknown): Record<string, unknown> | null {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

export function resolveOpenCodeRuntimeAuthSelection(params: Readonly<{
  selections: readonly unknown[];
  error: unknown;
}>): unknown | null {
  const error = readRecord(params.error);
  const errorServiceId = readOpenCodeConnectedServiceId(error?.serviceId);
  if (errorServiceId) {
    return findOpenCodeConnectedServiceSelection(params.selections, errorServiceId);
  }

  return resolveOpenCodeConnectedServiceSelectionByPrecedence(params.selections);
}

export function createOpenCodeConnectedServiceRuntimeAuthAdapter(): ConnectedServiceProviderRuntimeAuthAdapter {
  return {
    classifyRuntimeAuthFailure(input) {
      const selection = readRecord(input.selection);
      const error = readRecord(input.error);
      const classified = classifyOpenCodeUsageLimitError({
        providerErrorPath: true,
        error: input.error,
      });
      if (!classified) return null;
      const serviceId = readOpenCodeConnectedServiceId(error?.serviceId) ?? readOpenCodeConnectedServiceId(selection?.serviceId);
      if (!serviceId) return null;
      return {
        kind: classified.kind,
        limitCategory: classified.limitCategory,
        serviceId,
        profileId: readString(selection?.activeProfileId ?? selection?.profileId),
        groupId: readString(selection?.groupId),
        resetsAtMs: classified.resetAtMs,
        retryAfterMs: classified.retryAfterMs,
        planType: null,
        providerLimitId: classified.providerLimitId,
        quotaScope: classified.quotaScope,
        action: classified.action,
        rateLimits: classified,
        source: 'structured_provider_error',
      };
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
      const selection = readRecord(input.selection);
      const previousLaunchFingerprint = readString(selection?.previousLaunchFingerprint);
      if (!previousLaunchFingerprint) {
        return {
          recovered: true,
          recovery: 'restart_rematerialize',
          detached: false,
          detachedReason: 'prior_launch_fingerprint_missing',
        };
      }

      const previousOwnerToken = readString(selection?.previousOwnerToken);
      if (!previousOwnerToken) {
        return {
          recovered: true,
          recovery: 'restart_rematerialize',
          detached: false,
          detachedReason: 'prior_owner_token_missing',
        };
      }

      const detached = await releaseForAuthSwitch(previousLaunchFingerprint, previousOwnerToken);
      return {
        recovered: true,
        recovery: 'restart_rematerialize',
        detached: detached.released,
        detachedReason: detached.reason,
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
