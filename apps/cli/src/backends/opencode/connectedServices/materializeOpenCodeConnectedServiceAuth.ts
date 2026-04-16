import { join } from 'node:path';

import type { ConnectedServiceCredentialRecordV1 } from '@happier-dev/protocol';

import { writeJsonAtomic } from '@/utils/fs/writeJsonAtomic';
import {
  buildConnectedServiceOauthAuthEntry,
  requireConnectedServiceTokenCredentialRecord,
  requireConnectedServiceOauthCredentialRecordWithExpiry,
} from '@/daemon/connectedServices/shared/connectedServiceCredentialRecord';
import { probeOpenAiCodexOauthRefreshToken } from '@/backends/opencode/shared/openCodeAuthState';

export async function materializeOpenCodeConnectedServiceAuth(params: Readonly<{
  rootDir: string;
  openaiCodex: ConnectedServiceCredentialRecordV1 | null;
  openai: ConnectedServiceCredentialRecordV1 | null;
  anthropic: ConnectedServiceCredentialRecordV1 | null;
}>): Promise<Readonly<{ env: Record<string, string> }>> {
  const homeDir = join(params.rootDir, 'home');
  // Keep auth/state isolated via explicit XDG dirs, but do not override HOME /
  // USERPROFILE for the whole spawned session. On Windows, changing the process
  // home can break OpenCode CLI discovery when the working install is located
  // through real-user-home heuristics rather than a managed install.
  const xdgDataHome = join(homeDir, '.local', 'share');
  const xdgCacheHome = join(params.rootDir, 'xdg', 'cache');
  const xdgConfigHome = join(params.rootDir, 'xdg', 'config');
  const xdgStateHome = join(params.rootDir, 'xdg', 'state');

  const auth: Record<string, unknown> = {};

  if (params.openaiCodex) {
    const record = requireConnectedServiceOauthCredentialRecordWithExpiry(params.openaiCodex);
    const refreshTokenState = await probeOpenAiCodexOauthRefreshToken(record.oauth.refreshToken);
    if (refreshTokenState === 'invalid') {
      throw new Error('OpenCode OAuth credentials are stale or invalid. Reconnect OpenAI Codex.');
    }
    auth.openai = buildConnectedServiceOauthAuthEntry(record);
  } else if (params.openai) {
    const record = requireConnectedServiceTokenCredentialRecord(params.openai);
    auth.openai = {
      type: 'api',
      key: record.token.token,
    };
  }

  if (params.anthropic) {
    if (params.anthropic.kind === 'oauth') {
      throw new Error('Anthropic OAuth credentials are not supported. Reconnect using an Anthropic API key.');
    } else {
      auth.anthropic = {
        type: 'api',
        key: params.anthropic.token.token,
      };
    }
  }

  await writeJsonAtomic(join(xdgDataHome, 'opencode', 'auth.json'), auth);

  return {
    env: {
      XDG_DATA_HOME: xdgDataHome,
      XDG_CACHE_HOME: xdgCacheHome,
      XDG_CONFIG_HOME: xdgConfigHome,
      XDG_STATE_HOME: xdgStateHome,
    },
  };
}
