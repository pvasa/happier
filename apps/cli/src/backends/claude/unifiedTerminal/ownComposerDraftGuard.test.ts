import { describe, expect, it } from 'vitest';

import { createClaudeOwnComposerTextLog } from './ownComposerTextLog';
import { clearOwnLeftoverComposerDraft } from './ownComposerDraftGuard';

const OWN_TEXT = 'Reply with exactly: C11-baseline-ok';

function idleScreen(draft: string): string {
  return [
    '╭───────────────────────────────────────────────╮',
    `│ > ${draft}`,
    '╰───────────────────────────────────────────────╯',
    '  ⏵⏵ accept edits on (shift+tab to cycle)',
  ].join('\n');
}

function generatingScreen(draft: string): string {
  return [
    '● Working…',
    '✶ Forging… (12s · esc to interrupt)',
    '╭───────────────────────────────────────────────╮',
    `│ > ${draft}`,
    '╰───────────────────────────────────────────────╯',
  ].join('\n');
}

function ownLog(...texts: string[]) {
  const log = createClaudeOwnComposerTextLog();
  for (const text of texts) log.record(text);
  return log;
}

describe('clearOwnLeftoverComposerDraft (C11: idle pre-injection own-leftover guard)', () => {
  it('reports no_draft for an empty composer', async () => {
    const result = await clearOwnLeftoverComposerDraft({
      captureInputState: async () => ({ currentInput: idleScreen('') }),
      sendClearKey: async () => {
        throw new Error('must not clear an empty composer');
      },
      ownComposerTexts: ownLog(OWN_TEXT),
      wait: async () => undefined,
    });
    expect(result.status).toBe('no_draft');
  });

  it('clears an own leftover draft (seeded/recorded text) and reports cleared', async () => {
    const captures = [idleScreen(OWN_TEXT), idleScreen('')];
    let clears = 0;
    const result = await clearOwnLeftoverComposerDraft({
      captureInputState: async () => ({ currentInput: captures.shift() ?? idleScreen('') }),
      sendClearKey: async () => {
        clears += 1;
      },
      ownComposerTexts: ownLog(OWN_TEXT),
      wait: async () => undefined,
    });
    expect(result).toMatchObject({ status: 'cleared', attempts: 1 });
    expect(clears).toBe(1);
  });

  it('retries the bounded second clear when the first key leaves the draft behind', async () => {
    const captures = [idleScreen(OWN_TEXT), idleScreen(OWN_TEXT), idleScreen('')];
    let clears = 0;
    const attempts: number[] = [];
    const result = await clearOwnLeftoverComposerDraft({
      captureInputState: async () => ({ currentInput: captures.shift() ?? idleScreen('') }),
      sendClearKey: async () => {
        clears += 1;
      },
      ownComposerTexts: ownLog(OWN_TEXT),
      wait: async () => undefined,
      onClearAttempt: (info) => attempts.push(info.attempt),
    });
    expect(result).toMatchObject({ status: 'cleared', attempts: 2 });
    expect(clears).toBe(2);
    expect(attempts).toEqual([1, 2]);
  });

  it('gives up after the bounded attempts and reports clear_failed', async () => {
    let clears = 0;
    const result = await clearOwnLeftoverComposerDraft({
      captureInputState: async () => ({ currentInput: idleScreen(OWN_TEXT) }),
      sendClearKey: async () => {
        clears += 1;
      },
      ownComposerTexts: ownLog(OWN_TEXT),
      wait: async () => undefined,
    });
    expect(result.status).toBe('clear_failed');
    expect(clears).toBe(2);
  });

  it('NEVER touches a genuine user draft (no recorded match) and reports foreign_draft', async () => {
    const result = await clearOwnLeftoverComposerDraft({
      captureInputState: async () => ({ currentInput: idleScreen('my half-typed genuine thought') }),
      sendClearKey: async () => {
        throw new Error('must not clear a genuine user draft');
      },
      ownComposerTexts: ownLog(OWN_TEXT),
      wait: async () => undefined,
    });
    expect(result.status).toBe('foreign_draft');
  });

  it('never sends the clear key while the screen is generating (Escape would interrupt the turn)', async () => {
    const result = await clearOwnLeftoverComposerDraft({
      captureInputState: async () => ({ currentInput: generatingScreen(OWN_TEXT) }),
      sendClearKey: async () => {
        throw new Error('must not press Escape while generating');
      },
      ownComposerTexts: ownLog(OWN_TEXT),
      wait: async () => undefined,
    });
    expect(result.status).toBe('generating');
  });

  it('stops clearing when the draft mutates into foreign text mid-episode (user started typing)', async () => {
    const captures = [idleScreen(OWN_TEXT), idleScreen(`${OWN_TEXT} plus my new words`)];
    let clears = 0;
    const result = await clearOwnLeftoverComposerDraft({
      captureInputState: async () => ({ currentInput: captures.shift() ?? idleScreen('') }),
      sendClearKey: async () => {
        clears += 1;
      },
      ownComposerTexts: ownLog(OWN_TEXT),
      wait: async () => undefined,
    });
    expect(result.status).toBe('foreign_draft');
    expect(clears).toBe(1);
  });

  it('reports capture_failed when the screen capture throws', async () => {
    const result = await clearOwnLeftoverComposerDraft({
      captureInputState: async () => {
        throw new Error('pane gone');
      },
      sendClearKey: async () => undefined,
      ownComposerTexts: ownLog(OWN_TEXT),
      wait: async () => undefined,
    });
    expect(result.status).toBe('capture_failed');
  });

  it('reports clear_failed when the clear key send throws', async () => {
    const result = await clearOwnLeftoverComposerDraft({
      captureInputState: async () => ({ currentInput: idleScreen(OWN_TEXT) }),
      sendClearKey: async () => {
        throw new Error('control port closed');
      },
      ownComposerTexts: ownLog(OWN_TEXT),
      wait: async () => undefined,
    });
    expect(result.status).toBe('clear_failed');
  });
});
