import type {
  LocalTurnLifecycleController,
  LocalTurnLifecycleEvent,
} from '@/agent/localControl/turnLifecycle';
import type { RawJSONLines } from '@/backends/claude/types';
import type { SessionHookData } from '../utils/startHookServer';
import { isSidechainSessionHook } from '../utils/sessionHookAttribution';
import { createClaudeProviderActivityLedger } from '../providerActivity/createClaudeProviderActivityLedger';
import { readClaudeTranscriptProviderActivity } from './readClaudeTranscriptProviderActivity';
import { readClaudeTranscriptTurnSignal } from './readClaudeTranscriptTurnSignal';

function readHookEventName(data: SessionHookData): string {
  const raw = data.hook_event_name ?? data.hookEventName;
  return typeof raw === 'string' ? raw : '';
}

function readHookErrorDiscriminator(data: SessionHookData): string | undefined {
  const raw = data.error ?? data.error_type;
  return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : undefined;
}

function hookReportsNoActiveBackgroundTasks(data: SessionHookData): boolean {
  const raw = data.background_tasks ?? data.backgroundTasks;
  return Array.isArray(raw) && raw.length === 0;
}

function hookToLifecycleEvent(data: SessionHookData): LocalTurnLifecycleEvent | null {
  const hookEventName = readHookEventName(data);
  if (hookEventName === 'UserPromptSubmit') {
    return { type: 'turn_started', providerTurnId: null, source: 'claude_hook_user_prompt_submit' };
  }
  if (hookEventName === 'Stop') {
    return { type: 'completion_candidate', providerTurnId: null, source: 'claude_hook_stop' };
  }
  if (hookEventName === 'StopFailure') {
    return {
      type: 'turn_terminal',
      providerTurnId: null,
      reason: 'failed',
      source: 'claude_hook_stop_failure',
      detail: readHookErrorDiscriminator(data),
    };
  }
  if (hookEventName === 'SessionEnd') {
    return { type: 'session_ended', source: 'claude_hook_session_end' };
  }
  return null;
}

export function createClaudeLocalLifecycleTracker(opts: Readonly<{
  lifecycle: LocalTurnLifecycleController;
}>) {
  const providerActivityLedger = createClaudeProviderActivityLedger();

  const observeLifecycle = (event: LocalTurnLifecycleEvent | null): void => {
    if (!event) return;
    if (event.type === 'completion_candidate' && providerActivityLedger.hasActiveProviderTasks()) {
      return;
    }
    opts.lifecycle.observe(event);
  };

  const observeProviderActivity = (message: RawJSONLines): void => {
    const activity = readClaudeTranscriptProviderActivity(message);
    if (!activity) return;
    if (activity.type === 'async_agent_started') {
      providerActivityLedger.noteTranscriptAsyncAgentTask(activity.taskId);
      observeLifecycle({
        type: 'continuation_detected',
        providerTurnId: null,
        source: 'claude_transcript_async_agent_launch',
      });
      return;
    }
    if (activity.terminal && activity.taskId) {
      providerActivityLedger.noteProviderTaskFinished(activity.taskId);
    }
    observeLifecycle({
      type: 'continuation_detected',
      providerTurnId: null,
      source: 'claude_transcript_task_notification',
    });
  };

  const observe = (event: LocalTurnLifecycleEvent | null): void => {
    observeLifecycle(event);
  };

  return {
    observeHook(data: SessionHookData): void {
      // Sidechain (subagent) hooks never drive the primary turn lifecycle: a
      // subagent StopFailure/Stop/SessionEnd is not primary-turn evidence.
      // Subagent activity is tracked through the transcript provider-activity
      // ledger instead (async launches / task notifications).
      if (isSidechainSessionHook(data)) return;
      if (readHookEventName(data) === 'Stop' && hookReportsNoActiveBackgroundTasks(data)) {
        providerActivityLedger.clearProviderTasks();
      }
      observe(hookToLifecycleEvent(data));
    },
    observeTranscript(message: RawJSONLines): void {
      observeProviderActivity(message);
      observe(readClaudeTranscriptTurnSignal(message));
    },
    observeProcessExit(): void {
      const snapshot = opts.lifecycle.snapshot();
      if (!snapshot.active || snapshot.terminal) return;
      opts.lifecycle.observe({
        type: 'turn_terminal',
        providerTurnId: snapshot.providerTurnId,
        reason: 'process-exited',
        source: 'claude_local_process_exit',
      });
    },
  };
}
