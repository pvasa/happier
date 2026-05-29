import type { ConnectedServicesProviderMaterializer } from '@/daemon/connectedServices/materialize/providerMaterializerTypes';
import { materializeClaudeConnectedServiceAuth } from './materializeClaudeConnectedServiceAuth';
import { materializeClaudeSubscriptionConnectedServiceAuth } from './materializeClaudeSubscriptionConnectedServiceAuth';

export function createClaudeConnectedServicesMaterializer(): ConnectedServicesProviderMaterializer {
  return async (params) => {
    const claudeSubscription = params.recordsByServiceId.get('claude-subscription') ?? null;
    const anthropic = params.recordsByServiceId.get('anthropic') ?? null;

    if (claudeSubscription) {
      const materialized = materializeClaudeSubscriptionConnectedServiceAuth({ record: claudeSubscription });
      return { env: materialized.env, cleanupOnFailure: null, cleanupOnExit: null };
    }

    if (!anthropic) return null;
    const materialized = materializeClaudeConnectedServiceAuth({ record: anthropic });
    return { env: materialized.env, cleanupOnFailure: null, cleanupOnExit: null };
  };
}
