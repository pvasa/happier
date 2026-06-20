import { join } from 'node:path';

import type { ConnectedServiceCredentialRecordV1 } from '@happier-dev/protocol';

import { writeJsonAtomic } from '@/utils/fs/writeJsonAtomic';
import {
  buildConnectedServiceOauthAuthEntry,
  requireConnectedServiceTokenCredentialRecord,
  requireConnectedServiceOauthCredentialRecordWithExpiry,
} from '@/daemon/connectedServices/shared/connectedServiceCredentialRecord';

export async function materializePiConnectedServiceAuth(params: Readonly<{
  rootDir: string;
  openaiCodex: ConnectedServiceCredentialRecordV1 | null;
  openai: ConnectedServiceCredentialRecordV1 | null;
  claudeSubscription: ConnectedServiceCredentialRecordV1 | null;
  anthropic: ConnectedServiceCredentialRecordV1 | null;
}>): Promise<Readonly<{ env: Record<string, string> }>> {
  const agentDir = join(params.rootDir, 'pi-agent-dir');
  const auth: Record<string, unknown> = {};
  const env: Record<string, string> = {
    PI_CODING_AGENT_DIR: agentDir,
  };

  if (params.openaiCodex) {
    const record = requireConnectedServiceOauthCredentialRecordWithExpiry(params.openaiCodex);
    auth['openai-codex'] = buildConnectedServiceOauthAuthEntry(record);
  }

  if (params.openai) {
    const record = requireConnectedServiceTokenCredentialRecord(params.openai);
    auth.openai = {
      type: 'api_key',
      key: record.token.token,
    };
  }

  if (params.claudeSubscription) {
    if (params.claudeSubscription.kind === 'oauth') {
      const record = requireConnectedServiceOauthCredentialRecordWithExpiry(params.claudeSubscription);
      auth.anthropic = buildConnectedServiceOauthAuthEntry(record);
    } else {
      const record = requireConnectedServiceTokenCredentialRecord(params.claudeSubscription);
      auth.anthropic = {
        type: 'api_key',
        key: record.token.token,
      };
    }
  } else if (params.anthropic) {
    if (params.anthropic.kind !== 'token') {
      throw new Error('Anthropic OAuth credentials are not supported. Reconnect using an Anthropic API key.');
    }
    auth.anthropic = {
      type: 'api_key',
      key: params.anthropic.token.token,
    };
  }

  await writeJsonAtomic(join(agentDir, 'auth.json'), auth);

  return {
    env,
  };
}
