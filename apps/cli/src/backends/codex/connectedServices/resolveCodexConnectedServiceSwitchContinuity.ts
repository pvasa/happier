import { AGENTS_CORE } from '@happier-dev/agents';

import type {
  ConnectedServiceSwitchContinuityParams,
  ConnectedServiceSwitchContinuityResult,
} from '@/backends/types';
import {
  hasExactConnectedServiceRestartContinuityContext,
  isSameConnectedServiceAuthGroup,
  providerSessionStateUnavailableForResume,
} from '@/backends/connectedServices/switchContinuityContext';
import { canResumeFromMaterializedState } from '@/daemon/connectedServices/stateSharing/canResumeFromMaterializedState';
import { createCodexConnectedServiceRuntimeAuthAdapter } from './createCodexConnectedServiceRuntimeAuthAdapter';

function supportsService(serviceId: string): boolean {
  return (AGENTS_CORE.codex.connectedServices.supportedServiceIds as readonly string[]).includes(serviceId);
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function resolveCodexConnectedServiceSwitchContinuity(
  params: ConnectedServiceSwitchContinuityParams,
): Promise<ConnectedServiceSwitchContinuityResult> {
  if (!supportsService(params.serviceId)) {
    return { mode: 'unsupported', reason: 'unsupported_service' };
  }
  if (params.serviceId !== 'openai-codex') {
    return { mode: 'unsupported', reason: 'codex_api_key_switch_continuity_unsupported' };
  }

  if (params.previousBinding?.source === 'connected' && params.runtimeAuthSelection) {
    const hotApply = createCodexConnectedServiceRuntimeAuthAdapter().canHotApply({
      target: { agentId: params.agentId },
      selection: params.runtimeAuthSelection,
    });
    if (
      hotApply
      && typeof hotApply === 'object'
      && !Array.isArray(hotApply)
      && (hotApply as Record<string, unknown>).supported === true
    ) {
      return { mode: 'hot_apply' };
    }
  }

  if (isSameConnectedServiceAuthGroup(params)) {
    if (!hasExactConnectedServiceRestartContinuityContext(params)) {
      return providerSessionStateUnavailableForResume();
    }

    const targetMaterializedRoot = asNonEmptyString(params.targetMaterializedRoot);
    const vendorResumeId = asNonEmptyString(params.vendorResumeId);
    const cwd = asNonEmptyString(params.cwd);
    const materializationIdentity = params.connectedServiceMaterializationIdentityV1 ?? null;
    const targetMaterializedEnv = params.targetMaterializedEnv ?? null;
    if (
      !targetMaterializedRoot
      || !vendorResumeId
      || !cwd
      || !materializationIdentity
      || !targetMaterializedEnv
    ) {
      return providerSessionStateUnavailableForResume();
    }

    const reachability = await canResumeFromMaterializedState({
      agentId: 'codex',
      serviceId: params.serviceId,
      targetMaterializedRoot,
      targetMaterializedEnv,
      requestedStateMode: 'isolated',
      effectiveStateMode: 'isolated',
      materializationIdentity,
      vendorResumeId,
      cwd,
      candidatePersistedSessionFile: params.candidatePersistedSessionFile ?? null,
    });
    return reachability.ok
      ? { mode: 'restart_same_home' }
      : providerSessionStateUnavailableForResume();
  }

  return { mode: 'restart_shared_state_required', reason: 'codex_shared_state_required' };
}
