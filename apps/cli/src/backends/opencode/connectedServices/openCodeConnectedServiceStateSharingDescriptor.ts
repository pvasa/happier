import type { ConnectedServiceStateSharingDescriptor } from '@/backends/types';

export const openCodeConnectedServiceStateSharingDescriptor = {
  providerId: 'opencode',
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
    secretEntries: ['OPENCODE_AUTH_CONTENT', 'auth.json'],
  },
} satisfies ConnectedServiceStateSharingDescriptor;
