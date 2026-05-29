import { z } from 'zod';

import {
  buildDeterministicSessionWorkStateItemId,
  buildVendorSessionWorkStateItemId,
} from '../../sessionWorkState/sessionWorkStateItemIds.js';
import type { SessionWorkStateItemV1, SessionWorkStateStatusV1 } from '../../sessionWorkState/sessionWorkStateV1.js';

const CLAUDE_TASK_TOOL_WORK_STATE_SOURCE_FAMILY = 'claude.task';

export const ClaudeTaskEventSchema = z
  .object({
    type: z.string().min(1),
    task_id: z.string().min(1),
    description: z.string().trim().min(1).optional(),
    summary: z.string().trim().min(1).optional(),
    status: z.string().min(1).optional(),
    start_time: z.union([z.string(), z.number()]).optional(),
    end_time: z.union([z.string(), z.number()]).optional(),
  })
  .passthrough();
export type ClaudeTaskEvent = z.infer<typeof ClaudeTaskEventSchema>;

export const ClaudeTodoWriteTodoSchema = z
  .object({
    content: z.string().trim().min(1),
    status: z.string().min(1),
    activeForm: z.string().trim().min(1).optional(),
  })
  .passthrough();
export type ClaudeTodoWriteTodo = z.infer<typeof ClaudeTodoWriteTodoSchema>;

export const ClaudeTaskToolInputSchema = z
  .object({
    taskId: z.union([z.string(), z.number()]).optional(),
    subject: z.string().trim().min(1).optional(),
    title: z.string().trim().min(1).optional(),
    content: z.string().trim().min(1).optional(),
    description: z.string().trim().min(1).optional(),
    activeForm: z.string().trim().min(1).optional(),
    status: z.string().trim().min(1).optional(),
  })
  .passthrough();
export type ClaudeTaskToolInput = z.infer<typeof ClaudeTaskToolInputSchema>;

export const ClaudeTaskToolRecordSchema = ClaudeTaskToolInputSchema.extend({
  id: z.union([z.string(), z.number()]).optional(),
});
export type ClaudeTaskToolRecord = z.infer<typeof ClaudeTaskToolRecordSchema>;

function normalizeTimestampMs(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return value;
  if (typeof value !== 'string') return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function normalizeClaudeTaskStatus(status: unknown, type: string): SessionWorkStateStatusV1 {
  if (status === 'completed') return 'complete';
  if (status === 'stopped') return 'cancelled';
  if (status === 'failed' || status === 'error') return 'blocked';
  if (status === 'pending') return 'pending';
  if (status === 'running' || status === 'active' || type === 'task_started' || type === 'task_progress') return 'active';
  return 'unknown';
}

function normalizeClaudeTodoStatus(status: string): SessionWorkStateStatusV1 {
  if (status === 'pending') return 'pending';
  if (status === 'in_progress') return 'active';
  if (status === 'completed') return 'complete';
  return 'unknown';
}

function normalizeClaudeTaskToolStatus(status: unknown, fallback: SessionWorkStateStatusV1): SessionWorkStateStatusV1 {
  if (status === 'pending') return 'pending';
  if (status === 'in_progress' || status === 'active' || status === 'running') return 'active';
  if (status === 'completed' || status === 'complete') return 'complete';
  if (status === 'failed' || status === 'error' || status === 'blocked') return 'blocked';
  if (status === 'cancelled' || status === 'canceled' || status === 'stopped') return 'cancelled';
  return fallback;
}

function readTaskToolTitle(record: ClaudeTaskToolInput): string | null {
  return record.subject ?? record.title ?? record.content ?? record.description ?? record.activeForm ?? null;
}

function readTaskToolSummary(record: ClaudeTaskToolInput, title: string): string | null {
  const summary = record.activeForm ?? record.description ?? null;
  return summary && summary !== title ? summary : null;
}

function readTaskToolId(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
}

function buildClaudeTaskToolWorkStateItemId(vendorRef: string): string {
  return buildDeterministicSessionWorkStateItemId({
    kind: 'task',
    sourceFamily: CLAUDE_TASK_TOOL_WORK_STATE_SOURCE_FAMILY,
    stableParts: [vendorRef],
  });
}

export function normalizeClaudeTaskEventToWorkStateItem(params: Readonly<{
  backendId: string;
  agentId?: string;
  updatedAt: number;
  event: unknown;
}>): SessionWorkStateItemV1 | null {
  const parsed = ClaudeTaskEventSchema.safeParse(params.event);
  if (!parsed.success) return null;
  const completedAt = normalizeTimestampMs(parsed.data.end_time);
  const startedAt = normalizeTimestampMs(parsed.data.start_time);
  return {
    id: buildVendorSessionWorkStateItemId('task', parsed.data.task_id),
    kind: 'task',
    origin: 'vendor',
    status: normalizeClaudeTaskStatus(parsed.data.status, parsed.data.type),
    title: parsed.data.description ?? parsed.data.summary ?? parsed.data.task_id,
    ...(parsed.data.summary ? { summary: parsed.data.summary } : {}),
    backendId: params.backendId,
    ...(params.agentId ? { agentId: params.agentId } : {}),
    vendorRef: parsed.data.task_id,
    ...(startedAt !== null ? { startedAt } : {}),
    ...(completedAt !== null ? { completedAt } : {}),
    updatedAt: params.updatedAt,
  };
}

export function normalizeClaudeTaskToolUseToWorkStateItem(params: Readonly<{
  backendId: string;
  agentId?: string;
  updatedAt: number;
  toolName: unknown;
  toolUseId?: unknown;
  input: unknown;
}>): SessionWorkStateItemV1 | null {
  if (params.toolName !== 'TaskCreate' && params.toolName !== 'TaskUpdate') return null;
  const parsed = ClaudeTaskToolInputSchema.safeParse(params.input);
  if (!parsed.success) return null;
  if (parsed.data.status === 'deleted') return null;

  const vendorRef = params.toolName === 'TaskCreate'
    ? readTaskToolId(params.toolUseId)
    : readTaskToolId(parsed.data.taskId);
  if (!vendorRef) return null;

  const normalizedVendorRef = params.toolName === 'TaskCreate' ? `tool_use:${vendorRef}` : vendorRef;
  const title = readTaskToolTitle(parsed.data) ?? normalizedVendorRef;
  const summary = readTaskToolSummary(parsed.data, title);

  return {
    id: buildClaudeTaskToolWorkStateItemId(normalizedVendorRef),
    kind: 'task',
    origin: 'vendor',
    status: normalizeClaudeTaskToolStatus(parsed.data.status, params.toolName === 'TaskCreate' ? 'pending' : 'unknown'),
    title,
    ...(summary ? { summary } : {}),
    backendId: params.backendId,
    ...(params.agentId ? { agentId: params.agentId } : {}),
    vendorRef: normalizedVendorRef,
    updatedAt: params.updatedAt,
  };
}

export function normalizeClaudeTaskToolRecordsToWorkStateItems(params: Readonly<{
  backendId: string;
  agentId?: string;
  updatedAt: number;
  tasks: unknown;
}>): SessionWorkStateItemV1[] {
  const tasks = Array.isArray(params.tasks) ? params.tasks : [];
  return tasks.flatMap((task, index): SessionWorkStateItemV1[] => {
    const parsed = ClaudeTaskToolRecordSchema.safeParse(task);
    if (!parsed.success || parsed.data.status === 'deleted') return [];
    const vendorRef = readTaskToolId(parsed.data.id) ?? readTaskToolId(parsed.data.taskId);
    if (!vendorRef) return [];
    const title = readTaskToolTitle(parsed.data) ?? vendorRef;
    const summary = readTaskToolSummary(parsed.data, title);
    return [{
      id: buildClaudeTaskToolWorkStateItemId(vendorRef),
      kind: 'task',
      origin: 'vendor',
      status: normalizeClaudeTaskToolStatus(parsed.data.status, 'unknown'),
      title,
      ...(summary ? { summary } : {}),
      backendId: params.backendId,
      ...(params.agentId ? { agentId: params.agentId } : {}),
      vendorRef,
      order: index,
      updatedAt: params.updatedAt,
    }];
  });
}

export function normalizeClaudeTodoWriteTodosToWorkStateItems(params: Readonly<{
  backendId: string;
  agentId?: string;
  updatedAt: number;
  todos: unknown;
}>): SessionWorkStateItemV1[] {
  const todos = Array.isArray(params.todos) ? params.todos : [];
  return todos.flatMap((todo, index): SessionWorkStateItemV1[] => {
    const parsed = ClaudeTodoWriteTodoSchema.safeParse(todo);
    if (!parsed.success) return [];
    return [{
      id: buildDeterministicSessionWorkStateItemId({
        kind: 'todo',
        sourceFamily: 'claude.todo',
        stableParts: [parsed.data.content, index],
      }),
      kind: 'todo',
      origin: 'vendor',
      status: normalizeClaudeTodoStatus(parsed.data.status),
      title: parsed.data.content,
      ...(parsed.data.activeForm ? { summary: parsed.data.activeForm } : {}),
      backendId: params.backendId,
      ...(params.agentId ? { agentId: params.agentId } : {}),
      order: index,
      updatedAt: params.updatedAt,
    }];
  });
}
