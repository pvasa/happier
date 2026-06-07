import { randomUUID } from 'node:crypto';

import type { TerminalInputInjectionV1 } from '@/agent/runtime/terminal/TerminalInputInjectionV1';
import { hasMultilinePayload } from '@/agent/runtime/terminal/injection/bracketedPaste';
import {
  TERMINAL_INPUT_MAX_WAIT_MS,
  TERMINAL_INPUT_QUIET_PERIOD_MS,
} from '@/agent/runtime/terminal/injection/arbiter';

import type { ClaudeUnifiedPromptBatch, ClaudeUnifiedPromptInjector } from './_types';
import type { ClaudeUnifiedTelemetrySink } from './telemetry';
import { emitClaudeUnifiedInjectionOutcome } from './telemetry';

export function createClaudeUnifiedPromptInjector<Mode = unknown>(opts: Readonly<{
  inputInjection: TerminalInputInjectionV1;
  createNonce?: (() => string) | undefined;
  telemetry?: ClaudeUnifiedTelemetrySink | undefined;
  onInjected?: ((batch: ClaudeUnifiedPromptBatch<Mode>) => void | Promise<void>) | undefined;
}>): ClaudeUnifiedPromptInjector<Mode> {
  const createNonce = opts.createNonce ?? randomUUID;

  return {
    async injectPrompt(batch: ClaudeUnifiedPromptBatch<Mode>) {
      const multiline = hasMultilinePayload(batch.message);
      const text = batch.message;

      const input = {
        text,
        multiline,
        origin: {
          kind: batch.origin.kind,
          clientId: batch.origin.clientId,
          nonce: batch.origin.nonce ?? createNonce(),
        },
        scheduling: {
          deferredUntilQuietMs: TERMINAL_INPUT_QUIET_PERIOD_MS,
          timeoutMs: TERMINAL_INPUT_MAX_WAIT_MS,
        },
      } as const;
      const result = await opts.inputInjection.injectUserPrompt(input);
      if (opts.telemetry) {
        emitClaudeUnifiedInjectionOutcome(opts.telemetry, {
          result,
          hostKind: opts.inputInjection.hostKind,
          multiline,
          originKind: batch.origin.kind,
        });
      }
      if (result.status === 'injected') {
        await opts.onInjected?.(batch);
      }
      return result;
    },
  };
}
