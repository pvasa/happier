import type { RawJSONLines } from '../types';

type AcceptedPrompt = Readonly<{
  text: string;
  acceptedAtMs: number;
  expiresAtMs: number;
}>;

export type ClaudeUnifiedAcceptedPromptTranscriptDiscovery = Readonly<{
  recordAcceptedPrompt(input: Readonly<{ message: string; acceptedAtMs?: number | undefined }>): void;
  consumeMatchingTranscript(messages: readonly RawJSONLines[]): boolean;
}>;

function readMessageTimestampMs(message: RawJSONLines): number | null {
  const raw = (message as Record<string, unknown>).timestamp;
  if (typeof raw !== 'string' || raw.trim().length === 0) return null;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function readCommandNamePromptText(content: string): string | null {
  const match = content.match(/<command-name>\s*([^<]+?)\s*<\/command-name>/);
  const commandName = match?.[1]?.trim();
  return commandName && commandName.startsWith('/') ? commandName : null;
}

function readUserPromptTexts(message: RawJSONLines): readonly string[] {
  if (message.type !== 'user') return [];
  const content = message.message?.content;
  if (typeof content !== 'string' || content.length === 0) return [];
  const commandName = readCommandNamePromptText(content);
  return commandName ? [content, commandName] : [content];
}

function promptTextsMatch(transcriptText: string, acceptedPromptText: string): boolean {
  if (transcriptText === acceptedPromptText) return true;
  return transcriptText.startsWith('/')
    && acceptedPromptText.startsWith(`${transcriptText} `);
}

export function createClaudeUnifiedAcceptedPromptTranscriptDiscovery(opts: Readonly<{
  acceptedPromptWindowMs: number;
  nowMs?: (() => number) | undefined;
}>): ClaudeUnifiedAcceptedPromptTranscriptDiscovery {
  const acceptedPrompts: AcceptedPrompt[] = [];
  const nowMs = opts.nowMs ?? Date.now;
  const acceptedPromptWindowMs = Math.max(100, Math.trunc(opts.acceptedPromptWindowMs));

  function pruneExpired(referenceMs: number): void {
    while (acceptedPrompts.length > 0) {
      const next = acceptedPrompts[0];
      if (!next || next.expiresAtMs >= referenceMs) return;
      acceptedPrompts.shift();
    }
  }

  function matchesPromptWindow(message: RawJSONLines, acceptedPrompt: AcceptedPrompt): boolean {
    const timestampMs = readMessageTimestampMs(message);
    if (timestampMs === null) {
      return nowMs() <= acceptedPrompt.expiresAtMs;
    }
    return timestampMs >= acceptedPrompt.acceptedAtMs - acceptedPromptWindowMs
      && timestampMs <= acceptedPrompt.expiresAtMs;
  }

  return {
    recordAcceptedPrompt(input) {
      if (input.message.length === 0) return;
      const rawAcceptedAtMs = input.acceptedAtMs;
      const acceptedAtMs =
        typeof rawAcceptedAtMs === 'number' && Number.isFinite(rawAcceptedAtMs)
          ? Math.trunc(rawAcceptedAtMs)
          : nowMs();
      pruneExpired(acceptedAtMs);
      acceptedPrompts.push({
        text: input.message,
        acceptedAtMs,
        expiresAtMs: acceptedAtMs + acceptedPromptWindowMs,
      });
    },

    consumeMatchingTranscript(messages) {
      pruneExpired(nowMs());
      for (const message of messages) {
        const texts = readUserPromptTexts(message);
        if (texts.length === 0) continue;
        const matchIndex = acceptedPrompts.findIndex((acceptedPrompt) => (
          texts.some((text) => promptTextsMatch(text, acceptedPrompt.text)) && matchesPromptWindow(message, acceptedPrompt)
        ));
        if (matchIndex < 0) continue;
        acceptedPrompts.splice(matchIndex, 1);
        return true;
      }
      return false;
    },
  };
}
