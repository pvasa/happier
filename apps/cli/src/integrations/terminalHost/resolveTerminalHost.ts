import type {
  TerminalHostAdapter,
  TerminalHostPreference,
  TerminalHostResolution,
  TerminalHostResolverPlatform,
} from './_types';

export function resolveTerminalHost(params: Readonly<{
  preference: TerminalHostPreference;
  platform: TerminalHostResolverPlatform;
  adapters: Readonly<Partial<Record<'tmux' | 'zellij', TerminalHostAdapter>>>;
  tmuxAvailable: boolean;
  zellijAvailable: boolean;
}>): TerminalHostResolution {
  const { preference, platform, adapters } = params;

  if (platform.os === 'win32' && platform.arch === 'arm64') {
    return {
      status: 'disabled',
      reason: 'windows_arm64_unsupported',
      message: 'Bundled zellij has no upstream Windows ARM64 binary; install WSL2 or use Agent SDK runner.',
    };
  }

  if (preference === 'tmux') {
    if (platform.os === 'win32') {
      return {
        status: 'disabled',
        reason: 'tmux_unsupported_on_windows',
        message: "tmux is not supported on native Windows; use 'auto' or 'zellij', or install WSL2.",
      };
    }
    if (!params.tmuxAvailable || !adapters.tmux) {
      return { status: 'disabled', reason: 'tmux_unavailable', message: 'tmux is required for the selected terminal host.' };
    }
    return { status: 'resolved', adapter: adapters.tmux, reason: 'tmux_forced' };
  }

  if (preference === 'zellij') {
    if (!params.zellijAvailable || !adapters.zellij) {
      return { status: 'disabled', reason: 'zellij_unavailable', message: 'Bundled zellij is unavailable.' };
    }
    return { status: 'resolved', adapter: adapters.zellij, reason: 'zellij_forced' };
  }

  if (platform.os === 'win32') {
    if (!params.zellijAvailable || !adapters.zellij) {
      return { status: 'disabled', reason: 'zellij_unavailable', message: 'Bundled zellij is unavailable.' };
    }
    return { status: 'resolved', adapter: adapters.zellij, reason: 'windows_zellij' };
  }

  if (params.tmuxAvailable && adapters.tmux) {
    return { status: 'resolved', adapter: adapters.tmux, reason: 'tmux_available' };
  }

  if (params.zellijAvailable && adapters.zellij) {
    return { status: 'resolved', adapter: adapters.zellij, reason: 'tmux_unavailable' };
  }

  return { status: 'disabled', reason: 'no_host_available', message: 'No supported terminal host is available.' };
}
