import { join } from 'node:path';

import type { AccountSettings, ConnectedServiceCredentialRecordV1 } from '@happier-dev/protocol';

import { requireConnectedServiceOauthCredentialRecord } from '@/daemon/connectedServices/shared/connectedServiceCredentialRecord';
import { writeJsonAtomic } from '@/utils/fs/writeJsonAtomic';
import type { ConnectedServicesMaterializationDiagnostic } from '@/daemon/connectedServices/materialize/providerMaterializerTypes';
import { syncCodexConnectedServiceHome } from './syncCodexConnectedServiceHome';

export async function materializeCodexConnectedServiceAuth(params: Readonly<{
  rootDir: string;
  record: ConnectedServiceCredentialRecordV1;
  accountSettings?: AccountSettings | Readonly<Record<string, unknown>> | null;
  processEnv?: NodeJS.ProcessEnv;
}>): Promise<Readonly<{
  env: Record<string, string>;
  diagnostics?: readonly ConnectedServicesMaterializationDiagnostic[];
}>> {
  const record = requireConnectedServiceOauthCredentialRecord(params.record);
  const codexHome = join(params.rootDir, 'codex-home');
  const syncResult = await syncCodexConnectedServiceHome({
    destinationCodexHome: codexHome,
    accountSettings: params.accountSettings ?? null,
    processEnv: params.processEnv ?? process.env,
  });
  const tokens = {
    access_token: record.oauth.accessToken,
    refresh_token: record.oauth.refreshToken,
    id_token: record.oauth.idToken,
    account_id: record.oauth.providerAccountId,
  } as const;
  await writeJsonAtomic(join(codexHome, 'auth.json'), {
    auth_mode: 'chatgpt',
    OPENAI_API_KEY: null,
    ...tokens,
    // Match Codex CLI expectations while keeping our existing flat format for backward compatibility.
    tokens,
    last_refresh: new Date().toISOString(),
  });
  return {
    env: {
      CODEX_HOME: codexHome,
      CODEX_SQLITE_HOME: codexHome,
    },
    ...(syncResult.diagnostics.length > 0 ? { diagnostics: syncResult.diagnostics } : {}),
  };
}
