import { ReviewStartInputSchema, type ReviewStartInput } from '@happier-dev/protocol';

import { ReviewFollowUpIntentInputSchema } from '@/agent/reviews/followUp/reviewFollowUpIntentInput';
import { buildCodexNativeReviewInstructions } from './buildCodexNativeReviewInstructions';
import type { CodexAppServerReviewStartRequest, CodexAppServerReviewTarget } from './codexAppServerReviewTypes';

type CodexAppServerNativeReviewRequestResolution =
  | Readonly<{ ok: true; request: CodexAppServerReviewStartRequest; displayLabel: string }>
  | Readonly<{ ok: false; reason: 'not_review_intent' | 'invalid_review_input' | 'unsupported_follow_up'; error?: string }>;

export function resolveCodexAppServerNativeReviewRequest(params: Readonly<{
  start?: Readonly<{ intent?: string; intentInput?: unknown }> | null;
}>): CodexAppServerNativeReviewRequestResolution {
  if (params.start?.intent !== 'review') {
    return { ok: false, reason: 'not_review_intent' };
  }

  if (ReviewFollowUpIntentInputSchema.safeParse(params.start.intentInput).success) {
    return { ok: false, reason: 'unsupported_follow_up' };
  }

  const parsed = ReviewStartInputSchema.safeParse(params.start.intentInput);
  if (!parsed.success) {
    return { ok: false, reason: 'invalid_review_input', error: 'Invalid review input' };
  }

  const input = parsed.data;
  const userInstructions = input.instructions.trim();
  const exactNativeTarget = userInstructions.length === 0
    ? resolveExactNativeReviewTarget(input)
    : null;
  const target = exactNativeTarget ?? {
    type: 'custom',
    instructions: buildCodexNativeReviewInstructions(input),
  } satisfies CodexAppServerReviewTarget;

  if (target.type === 'custom' && target.instructions.trim().length === 0) {
    return { ok: false, reason: 'invalid_review_input', error: 'Invalid review input' };
  }

  return {
    ok: true,
    displayLabel: 'Codex review',
    request: {
      target,
      delivery: 'inline',
    },
  };
}

function resolveExactNativeReviewTarget(input: ReviewStartInput): CodexAppServerReviewTarget | null {
  if (input.changeType === 'uncommitted' && input.base.kind === 'none') {
    return { type: 'uncommittedChanges' };
  }
  if (input.changeType === 'committed' && input.base.kind === 'branch') {
    const branch = input.base.baseBranch.trim();
    return branch.length > 0 ? { type: 'baseBranch', branch } : null;
  }
  return null;
}
