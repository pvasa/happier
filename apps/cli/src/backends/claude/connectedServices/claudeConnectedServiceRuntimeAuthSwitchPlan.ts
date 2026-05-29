import type { ConnectedServiceCredentialRecordV1 } from '@happier-dev/protocol';

export type ClaudeConnectedServiceRuntimeAuthSwitchPlan = Readonly<{
  supportsHotApply: false;
  recovery: 'restart_rematerialize';
  envKeys: ReadonlyArray<'ANTHROPIC_API_KEY' | 'CLAUDE_CODE_SETUP_TOKEN' | 'CLAUDE_CODE_OAUTH_TOKEN'>;
}>;

export function resolveClaudeConnectedServiceRuntimeAuthSwitchPlan(
  record: ConnectedServiceCredentialRecordV1,
): ClaudeConnectedServiceRuntimeAuthSwitchPlan {
  if (record.serviceId === 'anthropic') {
    return {
      supportsHotApply: false,
      recovery: 'restart_rematerialize',
      envKeys: ['ANTHROPIC_API_KEY'],
    };
  }
  if (record.kind === 'oauth') {
    return {
      supportsHotApply: false,
      recovery: 'restart_rematerialize',
      envKeys: ['CLAUDE_CODE_OAUTH_TOKEN'],
    };
  }
  return {
    supportsHotApply: false,
    recovery: 'restart_rematerialize',
    envKeys: ['CLAUDE_CODE_SETUP_TOKEN'],
  };
}
