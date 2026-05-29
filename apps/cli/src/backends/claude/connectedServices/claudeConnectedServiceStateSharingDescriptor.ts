import type { ConnectedServiceStateSharingDescriptor } from '@/backends/types';

export const claudeConnectedServiceStateSharingDescriptor = {
  providerId: 'claude',
  providerSupportStatus: 'unsupported',
  config: {
    supported: false,
    modes: ['isolated'],
    entries: [],
    unavailableReason: 'not_implemented',
  },
  state: {
    supported: false,
    modes: ['isolated'],
    entries: [],
    symlinkUnavailableDegradePolicy: 'block_continuity',
    unavailableReason: 'not_implemented',
  },
  authIsolation: {
    mode: 'process_env',
    secretEntries: ['CLAUDE_API_KEY', 'ANTHROPIC_API_KEY'],
  },
} satisfies ConnectedServiceStateSharingDescriptor;
