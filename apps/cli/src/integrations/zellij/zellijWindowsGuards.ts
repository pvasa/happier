export type ZellijWindowsGuardResult =
  | Readonly<{ status: 'ok'; shell?: string }>
  | Readonly<{
    status: 'disabled';
    reason: 'windows_arm64_unsupported' | 'windows_console_host_unsupported' | 'windows_zellij_tui_unsupported';
    message: string;
  }>;

export function resolveZellijWindowsGuard(params: Readonly<{
  platform: NodeJS.Platform;
  arch: NodeJS.Architecture;
  env: Readonly<Record<string, string | undefined>>;
  parentProcessName?: string;
}>): ZellijWindowsGuardResult {
  if (params.platform !== 'win32') {
    return { status: 'ok' };
  }

  if (params.arch === 'arm64') {
    return {
      status: 'disabled',
      reason: 'windows_arm64_unsupported',
      message: 'Bundled zellij has no upstream Windows ARM64 binary; install WSL2 or use Agent SDK runner.',
    };
  }

  const hasWindowsTerminalEnv = Boolean(params.env.WT_SESSION || params.env.TERM_PROGRAM === 'Windows_Terminal');
  if (!hasWindowsTerminalEnv) {
    return {
      status: 'disabled',
      reason: 'windows_console_host_unsupported',
      message: 'Zellij unified terminal runtime requires Windows Terminal; install Windows Terminal and retry.',
    };
  }

  return {
    status: 'disabled',
    reason: 'windows_zellij_tui_unsupported',
    message:
      'Native Windows zellij does not provide TTY stdout/stderr to TUI child processes yet; use WSL2/Linux/macOS or the Agent SDK runner.',
  };
}
