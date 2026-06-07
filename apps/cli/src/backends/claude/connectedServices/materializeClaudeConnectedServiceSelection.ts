import type {
  AccountSettings,
  ConnectedServiceCredentialRecordV1,
  ConnectedServiceId,
} from '@happier-dev/protocol';

import type { ConnectedServicesMaterializationDiagnostic } from '@/daemon/connectedServices/materialize/providerMaterializerTypes';
import type { ConnectedServiceResolvedSelection } from '@/daemon/connectedServices/materialize/materializeConnectedServicesForSpawn';

import { materializeClaudeAnthropicApiKeyAuth } from './materializeClaudeAnthropicApiKeyAuth';
import {
  materializeClaudeSubscriptionNativeAuthHome,
  type ClaudeSubscriptionNativeAuthIdentityDiagnostic,
  type ClaudeSubscriptionNativeAuthSelectionDescriptor,
} from './nativeAuth/materializeClaudeCodeNativeAuth';
import { resolveClaudeConnectedServiceStableConfigDir } from './resolveClaudeConnectedServiceStableAuthDir';
import { syncClaudeConnectedServiceHome } from './syncClaudeConnectedServiceHome';

export type ClaudeConnectedServiceMaterializationServiceId = Extract<
  ConnectedServiceId,
  'claude-subscription' | 'anthropic'
>;

export type ClaudeConnectedServiceSelectionMaterialization = Readonly<{
  env: Record<string, string>;
  targetMaterializedRoot: string;
  diagnostics: readonly ConnectedServicesMaterializationDiagnostic[];
  identityDiagnostic?: ClaudeSubscriptionNativeAuthIdentityDiagnostic;
}>;

function buildClaudeSubscriptionNativeAuthSelectionDescriptor(params: Readonly<{
  fallbackProfileId: string;
  selection: ConnectedServiceResolvedSelection | null | undefined;
}>): ClaudeSubscriptionNativeAuthSelectionDescriptor {
  if (params.selection?.kind === 'group') {
    return {
      kind: 'group',
      serviceId: 'claude-subscription',
      groupId: params.selection.groupId,
      activeProfileId: params.selection.activeProfileId,
      fallbackProfileId: params.selection.fallbackProfileId,
      generation: params.selection.generation,
    };
  }
  return {
    kind: 'profile',
    serviceId: 'claude-subscription',
    profileId: params.selection?.kind === 'profile' ? params.selection.profileId : params.fallbackProfileId,
  };
}

export async function materializeClaudeConnectedServiceSelection(params: Readonly<{
  activeServerDir: string;
  serviceId: ClaudeConnectedServiceMaterializationServiceId;
  record: ConnectedServiceCredentialRecordV1;
  fallbackProfileId: string;
  selection?: ConnectedServiceResolvedSelection | null | undefined;
  processEnv: NodeJS.ProcessEnv;
  accountSettings?: AccountSettings | Readonly<Record<string, unknown>> | null;
  sessionDirectory?: string | null;
}>): Promise<ClaudeConnectedServiceSelectionMaterialization | null> {
  const claudeConfigDir = resolveClaudeConnectedServiceStableConfigDir({
    activeServerDir: params.activeServerDir,
    serviceId: params.serviceId,
    fallbackProfileId: params.fallbackProfileId,
    selection: params.selection ?? null,
  });
  if (!claudeConfigDir) return null;

  if (params.serviceId === 'claude-subscription') {
    const materialized = await materializeClaudeSubscriptionNativeAuthHome({
      record: params.record,
      targetClaudeConfigDir: claudeConfigDir,
      sourceEnv: params.processEnv,
      accountSettings: params.accountSettings ?? null,
      sessionDirectory: params.sessionDirectory ?? null,
      selectionDescriptor: buildClaudeSubscriptionNativeAuthSelectionDescriptor({
        fallbackProfileId: params.fallbackProfileId,
        selection: params.selection ?? null,
      }),
    });
    return {
      env: materialized.env,
      targetMaterializedRoot: claudeConfigDir,
      diagnostics: materialized.diagnostics,
      identityDiagnostic: materialized.identityDiagnostic,
    };
  }

  const syncResult = await syncClaudeConnectedServiceHome({
    sourceEnv: params.processEnv,
    targetDir: claudeConfigDir,
    accountSettings: params.accountSettings ?? null,
    sessionDirectory: params.sessionDirectory ?? null,
  });
  const materialized = materializeClaudeAnthropicApiKeyAuth({ record: params.record });
  return {
    env: {
      ...materialized.env,
      CLAUDE_CONFIG_DIR: claudeConfigDir,
    },
    targetMaterializedRoot: claudeConfigDir,
    diagnostics: syncResult.diagnostics,
  };
}
