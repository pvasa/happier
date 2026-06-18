/**
 * Decides whether Hermes may run its native interactive TUI on this host
 * (local control) or must fall back to the remote ACP path.
 *
 * Local control requires a real TTY (the native `hermes chat` TUI takes over
 * stdin/stdout) and must not be explicitly overridden to remote. The result
 * is consumed by `createHermesSharedLocalControl` to gate the local launcher.
 */
export type HermesLocalControlSupport =
  | { ok: true }
  | { ok: false; reason: 'tty_unavailable' | 'forced_remote' };

export function resolveHermesLocalControlSupport(
  params: Readonly<{ hasTTY: boolean; forceRemote: boolean }>,
): HermesLocalControlSupport {
  // An explicit remote override wins over everything else so the reason is
  // unambiguous even on a TTY.
  if (params.forceRemote) {
    return { ok: false, reason: 'forced_remote' };
  }
  if (!params.hasTTY) {
    return { ok: false, reason: 'tty_unavailable' };
  }
  return { ok: true };
}
