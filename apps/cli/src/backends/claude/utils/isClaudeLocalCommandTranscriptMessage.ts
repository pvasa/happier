import type { RawJSONLines } from '../types';
import { isCompactHookLocalCommandStdout } from './isCompactHookLocalCommandStdout';

function firstClaudeMessageText(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const message = (value as Record<string, unknown>).message;
  if (!message || typeof message !== 'object' || Array.isArray(message)) return null;
  const content = (message as Record<string, unknown>).content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return null;
  for (const item of content) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const text = record.text ?? record.content;
    if (typeof text === 'string') return text;
  }
  return null;
}

export function isClaudeLocalCommandTranscriptMessage(message: RawJSONLines): boolean {
  if (message.type !== 'user') return false;
  const text = firstClaudeMessageText(message);
  if (!text) return false;
  const trimmed = text.trim();
  if (trimmed.startsWith('<local-command-caveat>')) return true;
  if (trimmed.startsWith('<local-command-stdout>') && isCompactHookLocalCommandStdout(message)) return true;
  return trimmed.includes('<command-name>/compact</command-name>');
}
