import type { ConnectedServiceCredentialRecordV1 } from '@happier-dev/protocol';

import {
  buildConnectedServiceOauthAuthEntry,
  requireConnectedServiceTokenCredentialRecord,
  requireConnectedServiceOauthCredentialRecordWithExpiry,
} from '@/daemon/connectedServices/shared/connectedServiceCredentialRecord';

export async function materializeOpenCodeConnectedServiceAuth(params: Readonly<{
  rootDir: string;
  openaiCodex: ConnectedServiceCredentialRecordV1 | null;
  openai: ConnectedServiceCredentialRecordV1 | null;
  claudeSubscription: ConnectedServiceCredentialRecordV1 | null;
  anthropic: ConnectedServiceCredentialRecordV1 | null;
}>): Promise<Readonly<{ env: Record<string, string> }>> {
  const auth: Record<string, unknown> = {};

  if (params.openaiCodex) {
    const record = requireConnectedServiceOauthCredentialRecordWithExpiry(params.openaiCodex);
    auth.openai = buildConnectedServiceOauthAuthEntry(record);
  } else if (params.openai) {
    const record = requireConnectedServiceTokenCredentialRecord(params.openai);
    auth.openai = {
      type: 'api',
      key: record.token.token,
    };
  }

  if (params.claudeSubscription) {
    if (params.claudeSubscription.kind !== 'token') {
      throw new Error('Claude subscription OAuth credentials are not supported by OpenCode. Reconnect using a Claude setup-token.');
    }
    auth.anthropic = {
      type: 'api',
      key: params.claudeSubscription.token.token,
    };
  } else if (params.anthropic) {
    if (params.anthropic.kind === 'oauth') {
      throw new Error('Anthropic OAuth credentials are not supported. Reconnect using an Anthropic API key.');
    } else {
      auth.anthropic = {
        type: 'api',
        key: params.anthropic.token.token,
      };
    }
  }

  return {
    env: {
      OPENCODE_AUTH_CONTENT: JSON.stringify(auth),
    },
  };
}
