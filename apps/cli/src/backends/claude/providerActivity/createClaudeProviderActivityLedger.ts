import { normalizeClaudeAgentSdkProviderTaskId } from '@/backends/claude/sdk/providerTaskStatus';

export type ClaudeProviderActivitySource =
    | 'assistant-auto-backgrounded-tool-result'
    | 'system-task-progress'
    | 'system-task-started'
    | 'transcript-async-agent-launch';

export {
    isTerminalClaudeAgentSdkProviderTaskStatus,
    normalizeClaudeAgentSdkProviderTaskId,
    normalizeClaudeAgentSdkProviderTaskStatus,
    readClaudeAgentSdkProviderTaskStatus,
} from '@/backends/claude/sdk/providerTaskStatus';

export type ClaudeProviderTaskBlocker = {
    taskId: string;
    sources: ClaudeProviderActivitySource[];
};

type ProviderTaskEntry = {
    taskId: string;
    sources: Set<ClaudeProviderActivitySource>;
};

export function createClaudeProviderActivityLedger() {
    const activeProviderTasks = new Map<string, ProviderTaskEntry>();

    const noteProviderTask = (
        taskId: unknown,
        source: ClaudeProviderActivitySource,
    ): string | null => {
        const normalizedTaskId = normalizeClaudeAgentSdkProviderTaskId(taskId);
        if (!normalizedTaskId) return null;

        const existing = activeProviderTasks.get(normalizedTaskId);
        if (existing) {
            existing.sources.add(source);
            return normalizedTaskId;
        }

        activeProviderTasks.set(normalizedTaskId, {
            taskId: normalizedTaskId,
            sources: new Set([source]),
        });
        return normalizedTaskId;
    };

    return {
        getActiveProviderTaskBlockers: (): ClaudeProviderTaskBlocker[] => Array.from(activeProviderTasks.values())
            .map((entry) => ({
                taskId: entry.taskId,
                sources: Array.from(entry.sources),
            })),
        getActiveProviderTaskCount: (): number => activeProviderTasks.size,
        hasActiveProviderTasks: (): boolean => activeProviderTasks.size > 0,
        noteBackgroundProviderTask: (taskId: unknown): string | null => noteProviderTask(
            taskId,
            'assistant-auto-backgrounded-tool-result',
        ),
        noteTranscriptAsyncAgentTask: (taskId: unknown): string | null => noteProviderTask(
            taskId,
            'transcript-async-agent-launch',
        ),
        noteProviderTaskFinished: (taskId: unknown): string | null => {
            const normalizedTaskId = normalizeClaudeAgentSdkProviderTaskId(taskId);
            if (!normalizedTaskId) return null;
            activeProviderTasks.delete(normalizedTaskId);
            return normalizedTaskId;
        },
        noteProviderTaskProgress: (taskId: unknown): string | null => noteProviderTask(
            taskId,
            'system-task-progress',
        ),
        noteProviderTaskStarted: (taskId: unknown): string | null => noteProviderTask(
            taskId,
            'system-task-started',
        ),
        clearProviderTasks: (): void => {
            activeProviderTasks.clear();
        },
    };
}
