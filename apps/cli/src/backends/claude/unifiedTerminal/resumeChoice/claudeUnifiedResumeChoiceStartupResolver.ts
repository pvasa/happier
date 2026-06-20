import type { ClaudeUnifiedTerminalResumeChoice } from '@happier-dev/agents';
import type { TerminalControlPort } from '@/integrations/terminalHost/controlTypes';

import type { ClaudeUnifiedStartupDialogResolver } from '../createClaudeUnifiedTerminalReadinessBridge';
import {
  answerClaudeResumeChoiceDialog,
  type ClaudeUnifiedResumeChoiceAnswer,
} from '../tuiControls/resumeChoice';
import type { ClaudeUnifiedResumeChoiceBroker } from './claudeUnifiedResumeChoiceBroker';

export function createClaudeUnifiedResumeChoiceStartupResolver(params: Readonly<{
  choice: ClaudeUnifiedTerminalResumeChoice;
  broker: ClaudeUnifiedResumeChoiceBroker;
  port: TerminalControlPort;
  wait: (ms: number) => Promise<void>;
  settleMs: number;
}>): ClaudeUnifiedStartupDialogResolver {
  let pendingAnswerTask: Promise<void> | null = null;
  let terminalAnswerInFlight = false;
  let autoAnswerFailed = false;
  let userChoiceClosed = false;

  const startUserChoice = (signal: AbortSignal): void => {
    params.broker.activate();
    if (userChoiceClosed || params.broker.hasPendingChoice() || pendingAnswerTask) return;
    pendingAnswerTask = params.broker.requestResumeChoice({ signal })
      .then(async (choice: ClaudeUnifiedResumeChoiceAnswer) => {
        terminalAnswerInFlight = true;
        const result = await answerClaudeResumeChoiceDialog({
          port: params.port,
          choice,
          wait: params.wait,
          settleMs: params.settleMs,
        }).finally(() => {
          terminalAnswerInFlight = false;
        });
        if (result.kind !== 'answered' && result.kind !== 'not_visible') {
          userChoiceClosed = true;
        }
      })
      .catch(() => {
        userChoiceClosed = true;
      })
      .finally(() => {
        pendingAnswerTask = null;
      });
  };

  return async ({ screenState, abortSignal }) => {
    if (!screenState.resumeChoiceDialogVisible) {
      if (params.broker.hasPendingChoice()) {
        params.broker.noteDialogResolvedInTerminal('resume_dialog_resolved_in_terminal');
        return { status: 'handled' };
      }
      return pendingAnswerTask ? { status: 'waiting_for_user' } : { status: 'unhandled' };
    }

    if (params.choice === 'ask_every_time') {
      if (userChoiceClosed) {
        return { status: 'unhandled' };
      }
      startUserChoice(abortSignal);
      return params.broker.hasPendingChoice() || terminalAnswerInFlight
        ? { status: 'waiting_for_user' }
        : { status: 'unhandled' };
    }

    if (autoAnswerFailed) {
      return { status: 'unhandled' };
    }

    const result = await answerClaudeResumeChoiceDialog({
      port: params.port,
      choice: params.choice,
      wait: params.wait,
      settleMs: params.settleMs,
    });

    if (result.kind === 'answered' || result.kind === 'not_visible') {
      return { status: 'handled' };
    }
    autoAnswerFailed = true;
    return { status: 'unhandled' };
  };
}
