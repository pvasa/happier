import { describe, expect, it } from 'vitest';

import {
    normalizeClaudeTaskToolRecordsToWorkStateItems,
    normalizeClaudeTaskToolUseToWorkStateItem,
    normalizeClaudeTaskEventToWorkStateItem,
    normalizeClaudeTodoWriteTodosToWorkStateItems,
} from './sessionTasks.js';

describe('Claude task and todo wire schemas', () => {
    it('normalizes task lifecycle statuses without leaking provider status values', () => {
        const item = normalizeClaudeTaskEventToWorkStateItem({
            backendId: 'claude',
            updatedAt: 456,
            event: {
                type: 'task_updated',
                task_id: 'task-1',
                description: 'Run migration',
                status: 'failed',
            },
        });

        expect(item).toMatchObject({
            id: 'task:task-1',
            kind: 'task',
            origin: 'vendor',
            status: 'blocked',
            title: 'Run migration',
            backendId: 'claude',
            vendorRef: 'task-1',
            updatedAt: 456,
        });
        expect((item?.status as string)).not.toBe('failed');
    });

    it('normalizes TodoWrite entries into generic todo items', () => {
        const items = normalizeClaudeTodoWriteTodosToWorkStateItems({
            backendId: 'claude',
            updatedAt: 789,
            todos: [
                { content: 'Patch schema', status: 'in_progress', activeForm: 'Patching schema' },
                { content: 'Run tests', status: 'pending', activeForm: 'Running tests' },
            ],
        });

        expect(items.map((item) => item.status)).toEqual(['active', 'pending']);
        expect(items[0]?.id).toMatch(/^todo:derived:/);
    });

    it('normalizes TaskCreate tool uses into provisional task items', () => {
        const item = normalizeClaudeTaskToolUseToWorkStateItem({
            backendId: 'claude',
            updatedAt: 101,
            toolName: 'TaskCreate',
            toolUseId: 'toolu_create_1',
            input: {
                subject: 'Patch work-state projection',
                description: 'Update Claude task tracking',
                activeForm: 'Patching work-state projection',
            },
        });

        expect(item).toMatchObject({
            id: 'task:derived:claude.task:tool_use%3Atoolu_create_1',
            kind: 'task',
            origin: 'vendor',
            status: 'pending',
            title: 'Patch work-state projection',
            summary: 'Patching work-state projection',
            vendorRef: 'tool_use:toolu_create_1',
            updatedAt: 101,
        });
    });

    it('normalizes TaskUpdate tool uses by Claude task id', () => {
        const item = normalizeClaudeTaskToolUseToWorkStateItem({
            backendId: 'claude',
            updatedAt: 102,
            toolName: 'TaskUpdate',
            input: {
                taskId: 'task_123',
                subject: 'Run regression tests',
                status: 'in_progress',
            },
        });

        expect(item).toMatchObject({
            id: 'task:derived:claude.task:task_123',
            kind: 'task',
            origin: 'vendor',
            status: 'active',
            title: 'Run regression tests',
            vendorRef: 'task_123',
            updatedAt: 102,
        });
    });

    it('omits deleted TaskUpdate items', () => {
        const item = normalizeClaudeTaskToolUseToWorkStateItem({
            backendId: 'claude',
            updatedAt: 103,
            toolName: 'TaskUpdate',
            input: {
                taskId: 'task_123',
                status: 'deleted',
            },
        });

        expect(item).toBeNull();
    });

    it('normalizes TaskList result records into task items', () => {
        const items = normalizeClaudeTaskToolRecordsToWorkStateItems({
            backendId: 'claude',
            updatedAt: 104,
            tasks: [
                { id: 'task_a', subject: 'Check docs', status: 'completed' },
                { taskId: 'task_b', subject: 'Fix parser', status: 'pending', activeForm: 'Fixing parser' },
                { id: 'task_deleted', subject: 'Old task', status: 'deleted' },
            ],
        });

        expect(items.map((item) => [item.vendorRef, item.status, item.title, item.summary])).toEqual([
            ['task_a', 'complete', 'Check docs', undefined],
            ['task_b', 'pending', 'Fix parser', 'Fixing parser'],
        ]);
    });
});
