import { isTerminalClaudeAgentSdkProviderTaskStatus } from '@/backends/claude/providerActivity/createClaudeProviderActivityLedger';
import type { RawJSONLines } from '@/backends/claude/types';

const TASK_NOTIFICATION_PREFIX_PATTERN = /^\s*<task-notification\b/i;
const TASK_ID_TAG_PATTERN = /<task-id>([^<]+)<\/task-id>/i;
const TASK_STATUS_TAG_PATTERN = /<status>([^<]+)<\/status>/i;

export type ClaudeTranscriptProviderActivity =
  | Readonly<{ type: 'async_agent_started'; taskId: string }>
  | Readonly<{ type: 'task_notification'; taskId: string | null; terminal: boolean }>;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readMessageRecord(value: unknown): Record<string, unknown> | null {
  return asRecord(asRecord(value)?.message);
}

function firstTextContent(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return null;
  for (const item of value) {
    const text = normalizeString(asRecord(item)?.text);
    if (text) return text;
  }
  return null;
}

function readOriginKind(message: RawJSONLines): string {
  return normalizeString(asRecord(asRecord(message)?.origin)?.kind);
}

function readTaskNotificationText(message: RawJSONLines): string | null {
  const text = firstTextContent(readMessageRecord(message)?.content);
  if (text && TASK_NOTIFICATION_PREFIX_PATTERN.test(text)) return text;
  return null;
}

export function isClaudeTranscriptTaskNotification(message: RawJSONLines): boolean {
  return readOriginKind(message) === 'task-notification' || readTaskNotificationText(message) !== null;
}

function readXmlTag(pattern: RegExp, text: string): string | null {
  const value = normalizeString(pattern.exec(text)?.[1]);
  return value || null;
}

function readTaskNotificationActivity(message: RawJSONLines): ClaudeTranscriptProviderActivity | null {
  if (!isClaudeTranscriptTaskNotification(message)) return null;
  const text = readTaskNotificationText(message);
  const taskId = text ? readXmlTag(TASK_ID_TAG_PATTERN, text) : null;
  const status = text ? readXmlTag(TASK_STATUS_TAG_PATTERN, text) : null;
  return {
    type: 'task_notification',
    taskId,
    terminal: isTerminalClaudeAgentSdkProviderTaskStatus(status),
  };
}

function readAsyncAgentStartedActivity(message: RawJSONLines): ClaudeTranscriptProviderActivity | null {
  const record = asRecord(message);
  const toolUseResult = asRecord(record?.toolUseResult) ?? asRecord(record?.tool_use_result);
  if (!toolUseResult) return null;
  if (toolUseResult.isAsync !== true) return null;
  if (normalizeString(toolUseResult.status).toLowerCase() !== 'async_launched') return null;
  const taskId = normalizeString(toolUseResult.agentId) || normalizeString(toolUseResult.agent_id);
  if (!taskId) return null;
  return { type: 'async_agent_started', taskId };
}

export function readClaudeTranscriptProviderActivity(message: RawJSONLines): ClaudeTranscriptProviderActivity | null {
  return readAsyncAgentStartedActivity(message) ?? readTaskNotificationActivity(message);
}
