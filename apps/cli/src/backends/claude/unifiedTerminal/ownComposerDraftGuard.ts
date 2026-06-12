import { parseClaudeScreenState, type ClaudeScreenState } from './tuiControls/screenState';

const DEFAULT_DRAFT_CLEAR_SETTLE_MS = 250;
// Same bounded semantics as the slash-control leftover clear (lane U): one clear key can leave the
// draft text behind, so allow a second press before giving up.
export const MAX_OWN_LEFTOVER_DRAFT_CLEAR_ATTEMPTS = 2;

export type OwnComposerDraftGuardResult =
  | Readonly<{ status: 'no_draft'; screen: ClaudeScreenState }>
  | Readonly<{ status: 'cleared'; screen: ClaudeScreenState; attempts: number }>
  /** Composer holds text we did NOT write — a genuine user draft that must never be touched. */
  | Readonly<{ status: 'foreign_draft'; screen: ClaudeScreenState }>
  /** Screen is generating: the clear key (Escape) would interrupt the running turn. */
  | Readonly<{ status: 'generating'; screen: ClaudeScreenState }>
  | Readonly<{ status: 'capture_failed' }>
  | Readonly<{ status: 'clear_failed'; screen: ClaudeScreenState }>;

/**
 * C11 (incident cmq8y3nlx): bounded clear of OUR OWN leftover composer text before acting on the
 * composer. The leftover classifier is the own-injected-text registry (`ownComposerTextLog`,
 * respawn-seeded from the persisted prompt store), so both the in-flight steer evaluator and the
 * idle pre-injection guard share one owner for "is this draft ours?" — a genuine user draft is
 * NEVER touched, and nothing is cleared while the screen is generating.
 *
 * Live-proven defect this guards (runner pid 83791, 09:34): idle injection typed the new prompt
 * AFTER a predecessor's leftover injection and submitted the concatenation as one corrupted prompt.
 */
export async function clearOwnLeftoverComposerDraft(opts: Readonly<{
  captureInputState: () => Promise<Readonly<{ currentInput: string }>>;
  /** Sends ONE composer-clear keypress (Escape). Only invoked for exact-match own leftovers. */
  sendClearKey: () => Promise<void>;
  ownComposerTexts: Readonly<{ matches: (draft: string) => boolean }>;
  settleMs?: number | undefined;
  wait?: ((ms: number) => Promise<void>) | undefined;
  /** Telemetry tap: fired after each clear attempt with the recaptured screen. */
  onClearAttempt?: ((info: Readonly<{ attempt: number; screen: ClaudeScreenState }>) => void) | undefined;
}>): Promise<OwnComposerDraftGuardResult> {
  const settleMs = Math.max(0, Math.trunc(opts.settleMs ?? DEFAULT_DRAFT_CLEAR_SETTLE_MS));
  const wait = opts.wait ?? ((ms: number) => new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  }));

  async function capture(): Promise<ClaudeScreenState | null> {
    try {
      return parseClaudeScreenState((await opts.captureInputState()).currentInput);
    } catch {
      return null;
    }
  }

  function classify(screen: ClaudeScreenState): 'empty' | 'own' | 'foreign' | 'generating' {
    const content = screen.composerContent ?? '';
    if (content.length === 0) return 'empty';
    if (screen.generating) return 'generating';
    return opts.ownComposerTexts.matches(content) ? 'own' : 'foreign';
  }

  let screen = await capture();
  if (!screen) return { status: 'capture_failed' };
  switch (classify(screen)) {
    case 'empty':
      return { status: 'no_draft', screen };
    case 'generating':
      return { status: 'generating', screen };
    case 'foreign':
      return { status: 'foreign_draft', screen };
    case 'own':
      break;
  }

  for (let attempt = 1; attempt <= MAX_OWN_LEFTOVER_DRAFT_CLEAR_ATTEMPTS; attempt += 1) {
    try {
      await opts.sendClearKey();
    } catch {
      return { status: 'clear_failed', screen };
    }
    await wait(settleMs);
    const recaptured = await capture();
    if (!recaptured) return { status: 'capture_failed' };
    screen = recaptured;
    opts.onClearAttempt?.({ attempt, screen });
    switch (classify(screen)) {
      case 'empty':
        return { status: 'cleared', screen, attempts: attempt };
      case 'generating':
        return { status: 'generating', screen };
      case 'foreign':
        // The draft changed under us (user started typing): stop immediately, never touch it.
        return { status: 'foreign_draft', screen };
      case 'own':
        break;
    }
  }
  return { status: 'clear_failed', screen };
}
