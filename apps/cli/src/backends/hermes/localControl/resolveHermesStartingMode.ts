/**
 * Decides whether a `happier hermes` run starts in local (native TUI) or remote
 * (ACP) mode. Default parity with `happier opencode`: a foreground terminal with
 * a TTY starts local; daemon/headless/no-TTY/force-remote start remote. An
 * explicit `--happy-starting-mode` wins, but `local` still requires support.
 */
import { resolveHermesLocalControlSupport } from './resolveHermesLocalControlSupport';

export function resolveHermesStartingMode(params: Readonly<{
  explicit?: 'local' | 'remote';
  startedBy?: 'daemon' | 'terminal';
  hasTTY: boolean;
  forceRemote: boolean;
}>): 'local' | 'remote' {
  const support = resolveHermesLocalControlSupport({ hasTTY: params.hasTTY, forceRemote: params.forceRemote });

  if (params.explicit === 'remote') {
    return 'remote';
  }
  if (params.explicit === 'local') {
    return support.ok ? 'local' : 'remote';
  }
  return params.startedBy === 'terminal' && support.ok ? 'local' : 'remote';
}
