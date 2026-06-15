import { readFile } from 'node:fs/promises';

import { classifyClaudeConnectedServiceRuntimeAuthFailure } from './classifyClaudeConnectedServiceRuntimeAuthFailure';
import { mapClaudeRateLimitEventToUsageDetails } from './mapClaudeRateLimitEventToUsageDetails';
import { resolveClaudeConnectedServiceRuntimeAuthSwitchPlan } from './claudeConnectedServiceRuntimeAuthSwitchPlan';
import { readClaudeRuntimeAuthHotApplyMetadata } from './claudeRuntimeAuthHotApplyMetadata';
import { buildClaudeSubscriptionNativeAuthSelectionDescriptor } from './materializeClaudeConnectedServiceSelection';
import { classifyClaudeCodeCredentialHealth } from './nativeAuth/claudeCodeCredentialHealth';
import {
  buildClaudeCodeCredentialPayload,
  computeClaudeCodeCredentialFingerprint,
  resolveClaudeCodeCredentialsFilePath,
} from './nativeAuth/claudeCodeCredentialFile';
import { materializeClaudeSubscriptionNativeAuthHome } from './nativeAuth/materializeClaudeCodeNativeAuth';
import { verifyClaudeCodeNativeAuth } from './nativeAuth/verifyClaudeCodeNativeAuth';
import type {
  ConnectedServiceProviderRuntimeAuthAdapter,
  ConnectedServiceRuntimeAuthTargetInput,
} from '@/daemon/connectedServices/runtimeAuth/types';
import type { ConnectedServiceCredentialRecordV1 } from '@happier-dev/protocol';

function readRecord(value: unknown): Record<string, unknown> | null {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function readCredentialRecord(input: ConnectedServiceRuntimeAuthTargetInput): ConnectedServiceCredentialRecordV1 | null {
  const selection = readRecord(input.selection);
  const record = readRecord(selection?.record);
  return record as ConnectedServiceCredentialRecordV1 | null;
}

function readSelectionDescriptor(input: ConnectedServiceRuntimeAuthTargetInput) {
  const selection = readRecord(input.selection);
  const record = readCredentialRecord(input);
  if (!record) {
    return null;
  }
  if (
    typeof selection?.groupId === 'string'
    && selection.groupId.trim().length > 0
    && typeof selection.activeProfileId === 'string'
    && selection.activeProfileId.trim().length > 0
  ) {
    return buildClaudeSubscriptionNativeAuthSelectionDescriptor({
      fallbackProfileId: record.profileId,
      selection: {
        kind: 'group',
        serviceId: 'claude-subscription',
        groupId: selection.groupId,
        activeProfileId: selection.activeProfileId,
        fallbackProfileId: readString(selection.fallbackProfileId) ?? selection.activeProfileId,
        generation: typeof selection.generation === 'number' && Number.isFinite(selection.generation)
          ? selection.generation
          : 0,
        record,
        policy: null,
      },
    });
  }
  return buildClaudeSubscriptionNativeAuthSelectionDescriptor({
    fallbackProfileId: record.profileId,
    selection: {
      kind: 'profile',
      serviceId: 'claude-subscription',
      profileId: record.profileId,
      record,
    },
  });
}

function readClaudeConfigDir(input: ConnectedServiceRuntimeAuthTargetInput): string | null {
  const selection = readRecord(input.selection);
  const env = readRecord(selection?.targetMaterializedEnv)
    ?? readRecord(selection?.materializedEnv)
    ?? readRecord(selection?.env);
  return readString(env?.CLAUDE_CONFIG_DIR);
}

async function materializedCredentialMatchesRecord(params: Readonly<{
  record: ConnectedServiceCredentialRecordV1;
  claudeConfigDir: string;
}>): Promise<boolean> {
  const built = buildClaudeCodeCredentialPayload(params.record);
  if (built.status !== 'ok') return false;
  try {
    const raw = JSON.parse(await readFile(resolveClaudeCodeCredentialsFilePath(params.claudeConfigDir), 'utf8')) as unknown;
    return computeClaudeCodeCredentialFingerprint(raw) === computeClaudeCodeCredentialFingerprint(built.payload);
  } catch {
    return false;
  }
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
      // The raw payload rides along even when details mapped, so the classifier can recover reset
      // timing the mapper could not place in the details (INC-4).
      return classifyClaudeConnectedServiceRuntimeAuthFailure({
        ...(details ? { details } : {}),
        error: input.error,
        selection: input.selection,
      });
    },
    async materializeActiveProfile() {
      return { supported: true };
    },
    canHotApply(input) {
      const record = readCredentialRecord(input);
      const metadata = readClaudeRuntimeAuthHotApplyMetadata(input.selection);
      if (record?.serviceId === 'claude-subscription' && metadata) {
        return {
          supported: true,
          mode: 'claude_subscription_group_runtime_config_rewrite',
        };
      }
      return { supported: false, recovery: 'restart_rematerialize' };
    },
    async hotApply(input) {
      const record = readCredentialRecord(input);
      const metadata = readClaudeRuntimeAuthHotApplyMetadata(input.selection);
      const selectionDescriptor = readSelectionDescriptor(input);
      if (record?.serviceId !== 'claude-subscription' || !metadata || !selectionDescriptor) {
        return { applied: false, reason: 'hot_apply_unsupported' };
      }
      const materialized = await materializeClaudeSubscriptionNativeAuthHome({
        record,
        targetClaudeConfigDir: metadata.runtimeClaudeConfigDir,
        sourceEnv: {
          ...process.env,
          CLAUDE_CONFIG_DIR: metadata.sourceClaudeConfigDir,
        },
        accountSettings: null,
        sessionDirectory: null,
        vendorResumeId: null,
        candidatePersistedSessionFile: null,
        selectionDescriptor,
      });
      const blockingDiagnostics = materialized.diagnostics.filter((diagnostic) => diagnostic.severity === 'blocking');
      if (blockingDiagnostics.length > 0 || materialized.status !== 'materialized') {
        return {
          applied: false,
          reason: blockingDiagnostics[0]?.code ?? 'claude_runtime_config_materialization_failed',
          recovery: 'restart_resume',
          diagnostics: materialized.diagnostics,
        };
      }
      return {
        applied: true,
        reason: 'claude_runtime_config_rewritten',
        targetMaterializedRoot: metadata.runtimeMaterializedRoot,
        targetMaterializedEnv: {
          CLAUDE_CONFIG_DIR: metadata.runtimeClaudeConfigDir,
        },
      };
    },
    async recoverAfterRuntimeAuthSwitch(input) {
      const record = readCredentialRecord(input);
      return {
        recovered: false,
        recovery: 'restart_rematerialize',
        ...(record ? { plan: resolveClaudeConnectedServiceRuntimeAuthSwitchPlan(record) } : {}),
      };
    },
    async verifyActiveAccount(input) {
      const record = readCredentialRecord(input);
      if (!record) {
        return {
          status: 'unavailable',
          retryable: true,
          reason: 'missing_connected_service_record',
        };
      }
      if (record.serviceId === 'anthropic') {
        return {
          status: 'verified',
          providerAccountId: record.kind === 'token' ? record.token.providerAccountId : record.oauth.providerAccountId,
          reason: 'anthropic_api_key_materialized',
        };
      }
      const recordHealth = classifyClaudeCodeCredentialHealth(record);
      if (recordHealth.status !== 'ok') {
        return {
          status: 'unavailable',
          retryable: false,
          reason: recordHealth.status,
          errorClassification: {
            missingScopes: [...recordHealth.missingScopes],
          },
        };
      }
      const claudeConfigDir = readClaudeConfigDir(input);
      if (!claudeConfigDir) {
        return {
          status: 'unavailable',
          retryable: false,
          reason: 'missing_materialized_claude_config_dir',
          errorClassification: {
            missingScopes: [],
          },
        };
      }
      const nativeAuth = await verifyClaudeCodeNativeAuth({ claudeConfigDir });
      if (nativeAuth.status !== 'ok') {
        return {
          status: 'unavailable',
          // An expired materialized credential is recoverable via a fresh credential
          // refresh + rematerialize; shape/scope defects are not.
          retryable: nativeAuth.status === 'expired',
          reason: nativeAuth.status,
          errorClassification: {
            missingScopes: [...nativeAuth.missingScopes],
          },
        };
      }
      const metadata = readClaudeRuntimeAuthHotApplyMetadata(input.selection);
      if (
        metadata
        && await materializedCredentialMatchesRecord({ record, claudeConfigDir })
      ) {
        return {
          status: 'weakly_verified',
          providerAccountId: record.kind === 'oauth' ? record.oauth.providerAccountId : null,
          // Claude Code does not expose exact live account identity. This verifies that the
          // shared group auth surface was rewritten from the selected credential.
          reason: 'claude_runtime_config_rewrite_probe_supported',
        };
      }
      return {
        status: 'unavailable',
        retryable: true,
        reason: 'claude_code_runtime_account_adoption_unproven',
        errorClassification: {
          missingScopes: [],
        },
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
