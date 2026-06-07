import type { ClaudeUnifiedPromptInjectionFailure } from './_types';

export class ClaudeUnifiedTerminalInjectionFailureError extends Error {
  readonly code = 'claude_unified_terminal_injection_failed';
  readonly failureState: ClaudeUnifiedPromptInjectionFailure['failureState'];
  readonly reason: ClaudeUnifiedPromptInjectionFailure['result']['reason'];
  readonly phase: ClaudeUnifiedPromptInjectionFailure['result']['phase'];
  readonly duplicateRisk: ClaudeUnifiedPromptInjectionFailure['result']['duplicateRisk'];
  readonly recoverable: ClaudeUnifiedPromptInjectionFailure['result']['recoverable'];

  constructor(failure: ClaudeUnifiedPromptInjectionFailure) {
    super(
      failure.failureState === 'failed_ambiguous'
        ? 'Claude unified terminal prompt submission could not be confirmed'
        : 'Claude unified terminal prompt injection failed',
    );
    this.name = 'ClaudeUnifiedTerminalInjectionFailureError';
    this.failureState = failure.failureState;
    this.reason = failure.result.reason;
    this.phase = failure.result.phase;
    this.duplicateRisk = failure.result.duplicateRisk;
    this.recoverable = failure.result.recoverable;
  }
}

export function isClaudeUnifiedTerminalInjectionFailureError(
  error: unknown,
): error is ClaudeUnifiedTerminalInjectionFailureError {
  return Boolean(error)
    && typeof error === 'object'
    && (error as { code?: unknown }).code === 'claude_unified_terminal_injection_failed';
}
