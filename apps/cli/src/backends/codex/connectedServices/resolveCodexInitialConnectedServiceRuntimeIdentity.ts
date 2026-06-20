import type { ConnectedServiceRuntimeAuthMetadataSession } from '@/daemon/connectedServices/connectedServiceChildEnvironment';

import { readCodexEnvironmentAuthTokens } from '../cli/auth/readCodexEnvironmentAuthState';
import type { CodexConnectedServiceRuntimeIdentitySeed } from './authApplication/types';
import { resolveOpenAiCodexDaemonRefreshSelection } from './resolveOpenAiCodexDaemonRefreshSelection';

export function resolveCodexInitialConnectedServiceRuntimeIdentity(
  env: Pick<NodeJS.ProcessEnv, string>,
  session?: ConnectedServiceRuntimeAuthMetadataSession | null,
): CodexConnectedServiceRuntimeIdentitySeed | null {
  const refreshSelection = resolveOpenAiCodexDaemonRefreshSelection(env, session);
  if (!refreshSelection) return null;

  const authTokens = readCodexEnvironmentAuthTokens(env);
  if (!authTokens.accountId) return null;

  const { selection } = refreshSelection;
  if (selection.kind === 'group') {
    return {
      serviceId: 'openai-codex',
      activeAccountId: authTokens.accountId,
      accountLabel: authTokens.accountLabel,
      profileId: selection.activeProfileId,
      groupId: selection.groupId,
      generation: selection.generation,
      source: 'spawn_selection',
    };
  }

  return {
    serviceId: 'openai-codex',
    activeAccountId: authTokens.accountId,
    accountLabel: authTokens.accountLabel,
    profileId: selection.profileId,
    ...(refreshSelection.recoveryGroupId ? { groupId: refreshSelection.recoveryGroupId } : {}),
    source: 'spawn_selection',
  };
}
