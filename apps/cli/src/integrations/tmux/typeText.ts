import type { TmuxCommandResult } from './types';
import type {
  TerminalInjectionDuplicateRisk,
  TerminalInjectionFailurePhase,
} from '../terminalHost/_types';
import { splitStringByCodePoints } from '../terminalHost/chunks';
import {
  createTerminalHostDeadline,
  remainingTerminalHostDeadlineMs,
} from '../terminalHost/deadline';
import { resolvePromptSubmitTimeoutMs } from '../terminalHost/promptSubmitTimeout';

export type TmuxCommandExecutor = (
  args: readonly string[],
  options?: Readonly<{ stdin?: string; timeoutMs?: number }>,
) => Promise<TmuxCommandResult | null>;

export type TmuxTypeTextResult =
  | Readonly<{ success: true }>
  | Readonly<{
      success: false;
      reason: 'invalid_chunk_size' | 'type_failed' | 'newline_failed' | 'submit_failed' | 'timeout';
      phase: TerminalInjectionFailurePhase;
      duplicateRisk: TerminalInjectionDuplicateRisk;
      progress: Readonly<{
        textMayHaveReachedPane: boolean;
        newlineMayHaveReachedPane: boolean;
        submitMayHaveReachedPane: boolean;
      }>;
    }>;

type TmuxTypeTextProgress = {
  textMayHaveReachedPane: boolean;
  newlineMayHaveReachedPane: boolean;
  submitMayHaveReachedPane: boolean;
};

function failedResult(params: Readonly<{
  reason: Extract<TmuxTypeTextResult, { success: false }>['reason'];
  phase: TerminalInjectionFailurePhase;
  duplicateRisk: TerminalInjectionDuplicateRisk;
  progress: TmuxTypeTextProgress;
}>): Extract<TmuxTypeTextResult, { success: false }> {
  return {
    success: false,
    reason: params.reason,
    phase: params.phase,
    duplicateRisk: params.duplicateRisk,
    progress: params.progress,
  };
}

function waitFor(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function commandSucceeded(
  executor: TmuxCommandExecutor,
  args: readonly string[],
  options?: Readonly<{ stdin?: string; timeoutMs?: number }>,
): Promise<'success' | 'failed' | 'timeout'> {
  const result = await executor(args, options);
  if (result?.timedOut) return 'timeout';
  return result !== null && result.returncode === 0 ? 'success' : 'failed';
}

async function timedCommandSucceeded(
  executor: TmuxCommandExecutor,
  args: readonly string[],
  deadline: number | undefined,
  options?: Readonly<{ stdin?: string }>,
): Promise<'success' | 'failed' | 'timeout'> {
  const timeoutMs = remainingTerminalHostDeadlineMs(deadline);
  if (timeoutMs === 0) return 'timeout';
  return commandSucceeded(executor, args, {
    ...(options?.stdin !== undefined ? { stdin: options.stdin } : {}),
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
  });
}

export async function typeTextViaSendKeys(params: Readonly<{
  executor: TmuxCommandExecutor;
  target: string;
  text: string;
  chunkSize: number;
  submitDelayMs?: number | undefined;
  timeoutMs?: number | undefined;
  wait?: ((delayMs: number) => Promise<void>) | undefined;
}>): Promise<TmuxTypeTextResult> {
  const progress: TmuxTypeTextProgress = {
    textMayHaveReachedPane: false,
    newlineMayHaveReachedPane: false,
    submitMayHaveReachedPane: false,
  };

  if (!Number.isSafeInteger(params.chunkSize) || params.chunkSize <= 0) {
    return failedResult({
      reason: 'invalid_chunk_size',
      phase: 'before_write',
      duplicateRisk: 'none',
      progress,
    });
  }

  const deadline = createTerminalHostDeadline(params.timeoutMs);
  const normalizedLines = params.text.replace(/\r\n?/g, '\n').split('\n');
  for (const [lineIndex, line] of normalizedLines.entries()) {
    if (line.length > 0) {
      for (const chunk of splitStringByCodePoints(line, params.chunkSize)) {
        const typed = await timedCommandSucceeded(params.executor, [
          'send-keys',
          '-t',
          params.target,
          '-l',
          '--',
          chunk,
        ], deadline);
        if (typed === 'timeout') {
          progress.textMayHaveReachedPane = true;
          return failedResult({
            reason: 'timeout',
            phase: 'during_write',
            duplicateRisk: 'possible',
            progress,
          });
        }
        if (typed === 'failed') {
          return failedResult({
            reason: 'type_failed',
            phase: 'during_write',
            duplicateRisk: progress.textMayHaveReachedPane || progress.newlineMayHaveReachedPane ? 'possible' : 'none',
            progress,
          });
        }
        progress.textMayHaveReachedPane = true;
      }
    }

    if (lineIndex < normalizedLines.length - 1) {
      const insertedNewline = await timedCommandSucceeded(params.executor, ['send-keys', '-t', params.target, 'C-j'], deadline);
      if (insertedNewline === 'timeout') {
        progress.newlineMayHaveReachedPane = true;
        return failedResult({
          reason: 'timeout',
          phase: 'during_write',
          duplicateRisk: 'possible',
          progress,
        });
      }
      if (insertedNewline === 'failed') {
        return failedResult({
          reason: 'newline_failed',
          phase: 'during_write',
          duplicateRisk: progress.textMayHaveReachedPane ? 'possible' : 'none',
          progress,
        });
      }
      progress.newlineMayHaveReachedPane = true;
    }
  }

  const submitDelayMs = params.submitDelayMs ?? 0;
  if (submitDelayMs > 0) {
    await (params.wait ?? waitFor)(submitDelayMs);
  }

  const submitDeadline = createTerminalHostDeadline(resolvePromptSubmitTimeoutMs({
    remainingTimeoutMs: remainingTerminalHostDeadlineMs(deadline),
    fallbackTimeoutMs: params.timeoutMs,
  }));
  const submitted = await timedCommandSucceeded(params.executor, ['send-keys', '-t', params.target, 'C-m'], submitDeadline);
  if (submitted === 'timeout') {
    progress.submitMayHaveReachedPane = true;
    return failedResult({
      reason: 'timeout',
      phase: 'after_enter_unknown',
      duplicateRisk: 'likely',
      progress,
    });
  }
  if (submitted === 'failed') {
    return failedResult({
      reason: 'submit_failed',
      phase: 'after_enter_unknown',
      duplicateRisk: progress.textMayHaveReachedPane || progress.newlineMayHaveReachedPane ? 'possible' : 'none',
      progress,
    });
  }

  return { success: true };
}
