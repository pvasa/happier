/**
 * Builds the argument vector for Hermes's native interactive TUI, `hermes chat`.
 * Resumes an existing session by id when known (the handoff / drive-existing
 * case); a fresh `chat` otherwise. The `hermes` command itself is resolved by
 * the caller via the backend's canonical binary resolution.
 *
 * Note: `hermes chat --resume <id>` requires the session to already exist —
 * passing a fresh id errors ("Session not found"), so a brand-new local session
 * starts without `--resume` and its id is discovered afterward.
 */
export function buildHermesChatArgs(params: Readonly<{
  resumeSessionId?: string | null;
  extraArgs?: readonly string[];
}>): string[] {
  const args = ['chat'];
  if (params.resumeSessionId) {
    args.push('--resume', params.resumeSessionId);
  }
  if (params.extraArgs && params.extraArgs.length > 0) {
    args.push(...params.extraArgs);
  }
  return args;
}
