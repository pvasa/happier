import { AGENTS_CORE } from '@happier-dev/agents';

import type {
  ConnectedServiceSwitchContinuityParams,
  ConnectedServiceSwitchContinuityResult,
} from '@/backends/types';
import {
  hasExactConnectedServiceRestartContinuityContext,
  isConnectedToConnectedServiceSwitch,
  providerSessionStateUnavailableForResume,
} from '@/backends/connectedServices/switchContinuityContext';
import { logger } from '@/ui/logger';

import {
  CLAUDE_CONNECTED_SERVICES_LEGACY_RESTART_SAME_HOME_ENV,
  verifyResumeReachableClaude,
} from './verifyResumeReachableClaude';

function supportsService(serviceId: string): boolean {
  return (AGENTS_CORE.claude.connectedServices.supportedServiceIds as readonly string[]).includes(serviceId);
}

function isLegacyClaudeConnectedServicesRollbackEnabled(env: NodeJS.ProcessEnv): boolean {
  return env[CLAUDE_CONNECTED_SERVICES_LEGACY_RESTART_SAME_HOME_ENV] === '1';
}

export async function resolveClaudeConnectedServiceSwitchContinuity(
  params: ConnectedServiceSwitchContinuityParams,
): Promise<ConnectedServiceSwitchContinuityResult> {
  if (!supportsService(params.serviceId)) {
    return { mode: 'unsupported', reason: 'unsupported_service' };
  }

  if (isLegacyClaudeConnectedServicesRollbackEnabled(process.env)) {
    logger.info(
      '[CONNECTED SERVICES] Using legacy Claude optimistic continuity. Set %s=0 to restore strict fail-closed behavior.',
      CLAUDE_CONNECTED_SERVICES_LEGACY_RESTART_SAME_HOME_ENV,
    );
    return { mode: 'restart_same_home' };
  }

  if (!isConnectedToConnectedServiceSwitch(params) || !hasExactConnectedServiceRestartContinuityContext(params)) {
    return providerSessionStateUnavailableForResume();
  }

  const reachability = await verifyResumeReachableClaude({
    vendorResumeId: params.vendorResumeId,
    processEnv: process.env,
  });
  return reachability.ok ? { mode: 'restart_same_home' } : providerSessionStateUnavailableForResume();
}
