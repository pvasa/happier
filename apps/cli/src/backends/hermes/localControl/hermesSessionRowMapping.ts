/**
 * Pure mapping from a Hermes `state.db` `messages` row to the mirror actions
 * Happier replays into the synced transcript while the native `hermes chat`
 * TUI drives a session on the host.
 *
 * Hermes persists complete messages (not streamed deltas), so each row maps to
 * zero or more fully-formed actions. The session-write adapter is responsible
 * for turning these actions into transcript writes; this module stays pure so
 * the row interpretation can be tested directly against real `state.db` shapes.
 */

export type HermesSessionRow = Readonly<{
  id: number;
  role: 'user' | 'assistant' | 'tool';
  content: string | null;
  /** Raw JSON string from the `tool_calls` column, when present. */
  toolCalls: string | null;
  toolCallId: string | null;
  toolName: string | null;
  reasoning: string | null;
  /** `active=1` in Hermes; superseded/edited rows are `active=0`. */
  active: boolean;
}>;

export type HermesMirrorAction =
  | { kind: 'user-text'; text: string }
  | { kind: 'assistant-text'; text: string }
  | { kind: 'reasoning'; text: string }
  | { kind: 'assistant-tool-calls'; calls: ReadonlyArray<HermesMirrorToolCall> }
  | { kind: 'tool-result'; toolCallId: string; toolName: string | null; content: string };

export type HermesMirrorToolCall = Readonly<{ id: string; name: string; argumentsJson: string }>;

function hasText(value: string | null): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function parseToolCalls(raw: string | null): HermesMirrorToolCall[] {
  if (!hasText(raw)) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Malformed tool_calls must not drop the rest of the row's content.
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const calls: HermesMirrorToolCall[] = [];
  for (const entry of parsed) {
    if (entry === null || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    const fn = (record.function ?? null) as Record<string, unknown> | null;
    const id = typeof record.id === 'string' ? record.id
      : typeof record.call_id === 'string' ? record.call_id
      : null;
    const name = fn && typeof fn.name === 'string' ? fn.name : null;
    if (!id || !name) continue;
    const argumentsJson = fn && typeof fn.arguments === 'string' ? fn.arguments : '';
    calls.push({ id, name, argumentsJson });
  }
  return calls;
}

export function mapHermesSessionRow(row: HermesSessionRow): HermesMirrorAction[] {
  if (!row.active) return [];

  if (row.role === 'user') {
    return hasText(row.content) ? [{ kind: 'user-text', text: row.content }] : [];
  }

  if (row.role === 'tool') {
    return typeof row.content === 'string'
      ? [{ kind: 'tool-result', toolCallId: row.toolCallId ?? '', toolName: row.toolName, content: row.content }]
      : [];
  }

  // assistant
  const actions: HermesMirrorAction[] = [];
  if (hasText(row.reasoning)) actions.push({ kind: 'reasoning', text: row.reasoning });
  if (hasText(row.content)) actions.push({ kind: 'assistant-text', text: row.content });
  const calls = parseToolCalls(row.toolCalls);
  if (calls.length > 0) actions.push({ kind: 'assistant-tool-calls', calls });
  return actions;
}
