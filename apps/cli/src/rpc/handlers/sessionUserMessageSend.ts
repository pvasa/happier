import { SessionUserMessageSendRequestSchema } from '@happier-dev/protocol';
import { SESSION_RPC_METHODS } from '@happier-dev/protocol/rpc';

import type { RpcHandlerRegistrar } from '@/api/rpc/types';
import type { SessionRuntimeControls } from './sessionControls';

const CODEX_REVIEW_COMMAND = '/codex.review';

function parseCodexReviewCommand(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (trimmed !== CODEX_REVIEW_COMMAND && !trimmed.startsWith(`${CODEX_REVIEW_COMMAND} `)) {
    return null;
  }
  const instructions = trimmed.slice(CODEX_REVIEW_COMMAND.length).trim();
  return {
    engineIds: ['codex'],
    instructions,
    runLocation: 'current_session',
    changeType: 'uncommitted',
    base: { kind: 'none' },
  };
}

function unsupportedInlineReview(): Readonly<{ ok: false; errorCode: string; error: string }> {
  return {
    ok: false,
    errorCode: 'unsupported_session_runtime_method',
    error: `unsupported_session_runtime_method:${SESSION_RPC_METHODS.SESSION_REVIEW_START_INLINE}`,
  };
}

export function registerSessionUserMessageSendHandler(
  rpc: RpcHandlerRegistrar,
  opts: Readonly<{
    enqueueSessionUserMessage?: ((request: {
      text: string;
      localId?: string;
      meta: Record<string, unknown>;
    }) => Promise<void> | void) | null;
    sessionRuntimeControls?: SessionRuntimeControls | null;
  }>,
): void {
  if (typeof opts.enqueueSessionUserMessage !== 'function') return;

  rpc.registerHandler(SESSION_RPC_METHODS.SESSION_USER_MESSAGE_SEND, async (raw: unknown) => {
    const parsed = SessionUserMessageSendRequestSchema.safeParse(raw);
    if (!parsed.success) {
      return { ok: false, error: 'Invalid params', errorCode: 'session_user_message_invalid_input' };
    }

    const inlineReviewInput = parseCodexReviewCommand(parsed.data.text);
    if (inlineReviewInput) {
      if (typeof opts.sessionRuntimeControls?.startInlineReview !== 'function') {
        return unsupportedInlineReview();
      }
      return await opts.sessionRuntimeControls.startInlineReview(inlineReviewInput);
    }

    await opts.enqueueSessionUserMessage?.({
      text: parsed.data.text,
      localId: parsed.data.localId,
      meta: parsed.data.meta,
    });
    return { ok: true };
  });
}
