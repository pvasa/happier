import type { ConnectedServicesProviderMaterializer } from '@/daemon/connectedServices/materialize/providerMaterializerTypes';
import { materializeGeminiConnectedServiceAuth } from './materializeGeminiConnectedServiceAuth';

export function createGeminiConnectedServicesMaterializer(): ConnectedServicesProviderMaterializer {
  return async (params) => {
    const gemini = params.recordsByServiceId.get('gemini') ?? null;
    if (!gemini) return null;
    const materialized = await materializeGeminiConnectedServiceAuth({ rootDir: params.rootDir, record: gemini });
    return { env: materialized.env, cleanupOnFailure: params.cleanupRoot, cleanupOnExit: null };
  };
}
