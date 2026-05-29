import { resolveConnectedServiceGroupHomeDir, resolveConnectedServiceHomeDir } from '@/daemon/connectedServices/homes/resolveConnectedServiceHomeDir';
import { requireConnectedServiceTokenCredentialRecord } from '@/daemon/connectedServices/shared/connectedServiceCredentialRecord';
import type { ConnectedServicesProviderMaterializer } from '@/daemon/connectedServices/materialize/providerMaterializerTypes';
import { materializeCodexConnectedServiceAuth } from './materializeCodexConnectedServiceAuth';

export function createCodexConnectedServicesMaterializer(): ConnectedServicesProviderMaterializer {
  return async (params) => {
    const codex = params.recordsByServiceId.get('openai-codex') ?? null;
    const openai = params.recordsByServiceId.get('openai') ?? null;

    if (codex) {
      const selection = params.selectionsByServiceId?.get(codex.serviceId);
      const stableRootDir = selection?.kind === 'group'
        ? resolveConnectedServiceGroupHomeDir({
            activeServerDir: params.activeServerDir,
            serviceId: codex.serviceId,
            groupId: selection.groupId,
            agentId: params.agentId,
          })
        : resolveConnectedServiceHomeDir({
            activeServerDir: params.activeServerDir,
            serviceId: codex.serviceId,
            profileId: codex.profileId,
            agentId: params.agentId,
          });
      const materialized = await materializeCodexConnectedServiceAuth({
        rootDir: stableRootDir,
        record: codex,
        accountSettings: params.accountSettings ?? null,
        processEnv: params.processEnv ?? process.env,
      });

      return {
        env: materialized.env,
        cleanupOnFailure: null,
        cleanupOnExit: null,
        ...(materialized.diagnostics && materialized.diagnostics.length > 0
          ? { diagnostics: materialized.diagnostics }
          : {}),
      };
    }

    if (!openai) return null;
    const token = requireConnectedServiceTokenCredentialRecord(openai);
    return { env: { OPENAI_API_KEY: token.token.token }, cleanupOnFailure: null, cleanupOnExit: null };
  };
}
