const DEFAULT_LIMIT = 32;

export type ClaudeOwnComposerTextLog = Readonly<{
  /** Record a text WE wrote into the TUI (injected prompt). Bounded FIFO. */
  record: (text: string) => void;
  /**
   * True when the composer draft EXACTLY matches a recorded own text (or one full line of a
   * recorded multiline text — the parsed composer content is the bottom composer line only).
   * Exact-match-only by design: a genuine user draft must never classify as ours.
   */
  matches: (draft: string) => boolean;
}>;

function normalize(value: string): string {
  return value.replace(/\r\n?/g, '\n').trim();
}

/**
 * Soft-wrap-insensitive form (C11 live, runner pid 20327): the TUI renders a long draft wrapped
 * across lines, so equality must ignore WHERE whitespace breaks fall — but every word must still
 * match exactly (a genuine user draft never collapses to a recorded text).
 */
function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ');
}

/**
 * Bounded log of texts the Claude Unified runtime itself wrote into the TUI (lane X, incident
 * cmq8y3nlx): a leftover composer draft that exactly matches one of them is OUR OWN residue (e.g. a
 * partial injection) and may be cleared, while anything else is treated as a genuine user draft.
 */
export function createClaudeOwnComposerTextLog(opts?: Readonly<{ limit?: number }>): ClaudeOwnComposerTextLog {
  const limit = Math.max(1, Math.trunc(opts?.limit ?? DEFAULT_LIMIT));
  const entries: string[][] = [];

  return {
    record(text) {
      const normalized = normalize(text);
      if (normalized.length === 0) return;
      const lines = normalized
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      entries.push([normalized, collapseWhitespace(normalized), ...lines]);
      while (entries.length > limit) entries.shift();
    },
    matches(draft) {
      const normalized = normalize(draft);
      if (normalized.length === 0) return false;
      const collapsed = collapseWhitespace(normalized);
      return entries.some(
        (candidates) => candidates.includes(normalized) || candidates.includes(collapsed),
      );
    },
  };
}
