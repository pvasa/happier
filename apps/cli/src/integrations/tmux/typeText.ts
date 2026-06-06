import type { TmuxCommandResult } from './types';
import type {
  TerminalInjectionDuplicateRisk,
  TerminalInjectionFailurePhase,
} from '../terminalHost/_types';

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

function chunkText(text: string, chunkSize: number): string[] {
  const codePoints = Array.from(text);
  const chunks: string[] = [];
  for (let index = 0; index < codePoints.length; index += chunkSize) {
    chunks.push(codePoints.slice(index, index + chunkSize).join(''));
  }
  return chunks;
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

function createDeadline(timeoutMs: number | undefined): number | undefined {
  return timeoutMs !== undefined && timeoutMs > 0 ? Date.now() + timeoutMs : undefined;
}

function remainingTimeoutMs(deadline: number | undefined): number | undefined {
  if (deadline === undefined) return undefined;
  return Math.max(0, deadline - Date.now());
}

function isDeadlineExpired(deadline: number | undefined): boolean {
  return remainingTimeoutMs(deadline) === 0;
}

async function timedCommandSucceeded(
  executor: TmuxCommandExecutor,
  args: readonly string[],
  deadline: number | undefined,
  options?: Readonly<{ stdin?: string }>,
): Promise<'success' | 'failed' | 'timeout'> {
  const timeoutMs = remainingTimeoutMs(deadline);
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

  const deadline = createDeadline(params.timeoutMs);
  const normalizedLines = params.text.replace(/\r\n?/g, '\n').split('\n');
  for (const [lineIndex, line] of normalizedLines.entries()) {
    if (line.length > 0) {
      for (const chunk of chunkText(line, params.chunkSize)) {
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

  if (isDeadlineExpired(deadline)) {
    return failedResult({
      reason: 'timeout',
      phase: 'after_write_before_enter',
      duplicateRisk: progress.textMayHaveReachedPane || progress.newlineMayHaveReachedPane ? 'possible' : 'none',
      progress,
    });
  }
  const submitDelayMs = params.submitDelayMs ?? 0;
  if (submitDelayMs > 0) {
    const timeoutMs = remainingTimeoutMs(deadline);
    if (timeoutMs === 0) {
      return failedResult({
        reason: 'timeout',
        phase: 'after_write_before_enter',
        duplicateRisk: progress.textMayHaveReachedPane || progress.newlineMayHaveReachedPane ? 'possible' : 'none',
        progress,
      });
    }
    if (timeoutMs !== undefined && timeoutMs < submitDelayMs) {
      await (params.wait ?? waitFor)(timeoutMs);
      return failedResult({
        reason: 'timeout',
        phase: 'after_write_before_enter',
        duplicateRisk: progress.textMayHaveReachedPane || progress.newlineMayHaveReachedPane ? 'possible' : 'none',
        progress,
      });
    }
    await (params.wait ?? waitFor)(submitDelayMs);
  }

  const submitted = await timedCommandSucceeded(params.executor, ['send-keys', '-t', params.target, 'C-m'], deadline);
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
