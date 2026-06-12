import type { RawJSONLines } from '../types';
import { readClaudeControlCommandRowShape } from '../utils/controlCommandRows';

/**
 * Controller-typed slash-command transcript echo suppression (incident 2026-06-11, L3).
 *
 * When the TUI runtime-control controller types `/effort` / `/model` into Claude's composer, Claude
 * writes JSONL user rows for the command (`<command-name>…</command-name>` + `<command-args>…`) and
 * its output (`<local-command-stdout>…`). Those rows are CONTROL bookkeeping, not conversation, and
 * must never reach the Happier UI as raw messages. Suppression is registration-based so a GENUINE
 * user-typed TUI slash command (no controller registration) still flows through untouched.
 *
 * Suppressed rows are reported through `onSuppressed` so the hosting launcher can persist a
 * consumed marker (`recordClaudeJsonlMessageConsumed`): without it the row stays uncommitted and
 * replays as a "new" message on every same-session relaunch (resume-replay leak, 2026-06-11).
 */
export type ClaudeUnifiedControlCommandEchoSuppressor = Readonly<{
  /** Register a command the controller actually submitted (e.g. `/effort medium`). */
  recordTypedControlCommand(commandText: string): void;
  /** True when the transcript row is the JSONL echo of a registered controller command. */
  shouldSuppressTranscriptMessage(message: RawJSONLines): boolean;
}>;

const DEFAULT_COMMAND_ECHO_WINDOW_MS = 60_000;
const DEFAULT_STDOUT_FOLLOW_WINDOW_MS = 15_000;

type RegisteredControlCommand = Readonly<{
  name: string;
  args: string;
  expiresAtMs: number;
}>;

function splitCommandText(commandText: string): { name: string; args: string } | null {
  const trimmed = commandText.trim();
  if (!trimmed.startsWith('/')) return null;
  const spaceIndex = trimmed.indexOf(' ');
  if (spaceIndex < 0) return { name: trimmed, args: '' };
  return { name: trimmed.slice(0, spaceIndex), args: trimmed.slice(spaceIndex + 1).trim() };
}

export function createClaudeUnifiedControlCommandEchoSuppressor(opts: Readonly<{
  nowMs?: (() => number) | undefined;
  commandEchoWindowMs?: number | undefined;
  stdoutFollowWindowMs?: number | undefined;
  /** Invoked for every suppressed row so the caller can persist a consumed marker. */
  onSuppressed?: ((message: RawJSONLines) => void) | undefined;
}> = {}): ClaudeUnifiedControlCommandEchoSuppressor {
  const nowMs = opts.nowMs ?? Date.now;
  const commandEchoWindowMs = Math.max(100, Math.trunc(opts.commandEchoWindowMs ?? DEFAULT_COMMAND_ECHO_WINDOW_MS));
  const stdoutFollowWindowMs = Math.max(100, Math.trunc(opts.stdoutFollowWindowMs ?? DEFAULT_STDOUT_FOLLOW_WINDOW_MS));

  const registered: RegisteredControlCommand[] = [];
  const pendingStdoutSuppressions: number[] = [];

  function pruneExpired(referenceMs: number): void {
    for (let i = registered.length - 1; i >= 0; i -= 1) {
      if (registered[i].expiresAtMs < referenceMs) registered.splice(i, 1);
    }
    for (let i = pendingStdoutSuppressions.length - 1; i >= 0; i -= 1) {
      if (pendingStdoutSuppressions[i] < referenceMs) pendingStdoutSuppressions.splice(i, 1);
    }
  }

  function noteSuppressed(message: RawJSONLines): true {
    opts.onSuppressed?.(message);
    return true;
  }

  return {
    recordTypedControlCommand(commandText) {
      const parts = splitCommandText(commandText);
      if (!parts) return;
      registered.push({ ...parts, expiresAtMs: nowMs() + commandEchoWindowMs });
    },

    shouldSuppressTranscriptMessage(message) {
      const shape = readClaudeControlCommandRowShape(message);
      if (!shape) return false;
      const referenceMs = nowMs();
      pruneExpired(referenceMs);

      if (shape.kind === 'stdout') {
        if (pendingStdoutSuppressions.length === 0) return false;
        pendingStdoutSuppressions.shift();
        return noteSuppressed(message);
      }

      const index = registered.findIndex((entry) => entry.name === shape.name && entry.args === shape.args);
      if (index < 0) return false;
      registered.splice(index, 1);
      // The command's `<local-command-stdout>` row follows shortly after; suppress exactly one.
      pendingStdoutSuppressions.push(referenceMs + stdoutFollowWindowMs);
      return noteSuppressed(message);
    },
  };
}
