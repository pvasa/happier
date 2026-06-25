import type { TerminalControlPort } from '@/integrations/terminalHost/controlTypes';

import {
  captureFailureToResult,
  captureScreenState,
  sendResultToFailure,
} from './controlRuntime';

export type ClaudeUnifiedResumeChoiceAnswer = 'resume_from_summary' | 'resume_full_session';

export type ClaudeResumeChoiceDialogAnswerResult =
  | Readonly<{ kind: 'answered'; choice: ClaudeUnifiedResumeChoiceAnswer }>
  | Readonly<{ kind: 'not_visible' }>
  | Readonly<{ kind: 'failed'; reason: string }>
  | Readonly<{ kind: 'unsupported'; reason?: string | undefined }>;

function controlFailureToResumeChoiceResult(
  failure: ReturnType<typeof sendResultToFailure> | ReturnType<typeof captureFailureToResult>,
): ClaudeResumeChoiceDialogAnswerResult | null {
  if (failure === null) return null;
  if (failure.kind === 'unsupported') return { kind: 'unsupported', reason: failure.reason };
  const reason = 'reason' in failure && typeof failure.reason === 'string'
    ? failure.reason
    : failure.kind;
  return { kind: 'failed', reason };
}

function optionForResumeChoice(choice: ClaudeUnifiedResumeChoiceAnswer): '1' | '2' {
  return choice === 'resume_from_summary' ? '1' : '2';
}

export async function answerClaudeResumeChoiceDialog(params: Readonly<{
  port: TerminalControlPort;
  choice: ClaudeUnifiedResumeChoiceAnswer;
  wait: (ms: number) => Promise<void>;
  settleMs: number;
}>): Promise<ClaudeResumeChoiceDialogAnswerResult> {
  const before = await captureScreenState(params.port);
  if (before.kind !== 'state') {
    return controlFailureToResumeChoiceResult(captureFailureToResult(before)) ?? { kind: 'failed', reason: 'capture_failed' };
  }
  if (!before.state.resumeChoiceDialogVisible) {
    return { kind: 'not_visible' };
  }

  const sendOptionFailure = controlFailureToResumeChoiceResult(
    sendResultToFailure(await params.port.sendLiteralText(optionForResumeChoice(params.choice))),
  );
  if (sendOptionFailure) return sendOptionFailure;

  const sendEnterFailure = controlFailureToResumeChoiceResult(
    sendResultToFailure(await params.port.sendSpecialKey('Enter')),
  );
  if (sendEnterFailure) return sendEnterFailure;

  await params.wait(params.settleMs);
  const after = await captureScreenState(params.port);
  if (after.kind !== 'state') {
    return controlFailureToResumeChoiceResult(captureFailureToResult(after)) ?? { kind: 'failed', reason: 'capture_failed' };
  }
  if (after.state.resumeChoiceDialogVisible) {
    return { kind: 'failed', reason: 'resume_choice_dialog_still_visible' };
  }
  return { kind: 'answered', choice: params.choice };
}
