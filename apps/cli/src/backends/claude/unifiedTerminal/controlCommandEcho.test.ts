import { describe, expect, it } from 'vitest';

import { createClaudeUnifiedControlCommandEchoSuppressor } from './controlCommandEcho';
import type { RawJSONLines } from '../types';

function userRow(content: string): RawJSONLines {
  return {
    type: 'user',
    message: { role: 'user', content },
    uuid: 'u-1',
    timestamp: '2026-06-11T09:00:00.000Z',
  } as unknown as RawJSONLines;
}

const EFFORT_COMMAND_ROW = userRow(
  '<command-name>/effort</command-name>\n<command-message>effort</command-message>\n<command-args>medium</command-args>',
);
const EFFORT_STDOUT_ROW = userRow('<local-command-stdout>Set effort level to medium</local-command-stdout>');

describe('createClaudeUnifiedControlCommandEchoSuppressor (incident 2026-06-11, L3)', () => {
  it('suppresses the JSONL command row and its stdout row for a controller-typed command', () => {
    let now = 1_000;
    const suppressor = createClaudeUnifiedControlCommandEchoSuppressor({ nowMs: () => now });

    suppressor.recordTypedControlCommand('/effort medium');
    now += 500;

    expect(suppressor.shouldSuppressTranscriptMessage(EFFORT_COMMAND_ROW)).toBe(true);
    expect(suppressor.shouldSuppressTranscriptMessage(EFFORT_STDOUT_ROW)).toBe(true);
    // One registration suppresses exactly one command+stdout pair.
    expect(suppressor.shouldSuppressTranscriptMessage(EFFORT_COMMAND_ROW)).toBe(false);
    expect(suppressor.shouldSuppressTranscriptMessage(EFFORT_STDOUT_ROW)).toBe(false);
  });

  it('never suppresses a genuine user-typed TUI command (no registration)', () => {
    const suppressor = createClaudeUnifiedControlCommandEchoSuppressor({ nowMs: () => 1_000 });

    expect(suppressor.shouldSuppressTranscriptMessage(EFFORT_COMMAND_ROW)).toBe(false);
    expect(suppressor.shouldSuppressTranscriptMessage(EFFORT_STDOUT_ROW)).toBe(false);
  });

  it('does not consume a registration for a command with different args', () => {
    let now = 1_000;
    const suppressor = createClaudeUnifiedControlCommandEchoSuppressor({ nowMs: () => now });

    suppressor.recordTypedControlCommand('/effort high');
    now += 100;

    // User typed `/effort medium` themselves: must surface, registration stays armed.
    expect(suppressor.shouldSuppressTranscriptMessage(EFFORT_COMMAND_ROW)).toBe(false);
    const highRow = userRow('<command-name>/effort</command-name>\n<command-args>high</command-args>');
    expect(suppressor.shouldSuppressTranscriptMessage(highRow)).toBe(true);
  });

  it('expires stale registrations after the bounded window', () => {
    let now = 1_000;
    const suppressor = createClaudeUnifiedControlCommandEchoSuppressor({
      nowMs: () => now,
      commandEchoWindowMs: 1_000,
    });

    suppressor.recordTypedControlCommand('/effort medium');
    now += 5_000;

    expect(suppressor.shouldSuppressTranscriptMessage(EFFORT_COMMAND_ROW)).toBe(false);
  });

  it('ignores assistant rows and non-command user rows', () => {
    const suppressor = createClaudeUnifiedControlCommandEchoSuppressor({ nowMs: () => 1_000 });
    suppressor.recordTypedControlCommand('/model sonnet');

    expect(suppressor.shouldSuppressTranscriptMessage({
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'text', text: 'hello' }] },
    } as unknown as RawJSONLines)).toBe(false);
    expect(suppressor.shouldSuppressTranscriptMessage(userRow('plain user prompt'))).toBe(false);
  });

  it('reports suppressed rows to onSuppressed so launchers can persist consumed markers (resume-replay leak)', () => {
    let now = 1_000;
    const suppressed: RawJSONLines[] = [];
    const suppressor = createClaudeUnifiedControlCommandEchoSuppressor({
      nowMs: () => now,
      onSuppressed: (message) => suppressed.push(message),
    });

    // Unregistered rows pass through and are never reported.
    expect(suppressor.shouldSuppressTranscriptMessage(EFFORT_COMMAND_ROW)).toBe(false);
    expect(suppressed).toHaveLength(0);

    suppressor.recordTypedControlCommand('/effort medium');
    now += 500;
    expect(suppressor.shouldSuppressTranscriptMessage(EFFORT_COMMAND_ROW)).toBe(true);
    expect(suppressor.shouldSuppressTranscriptMessage(EFFORT_STDOUT_ROW)).toBe(true);

    expect(suppressed).toEqual([EFFORT_COMMAND_ROW, EFFORT_STDOUT_ROW]);
  });

  it('suppresses a stdout row only while a matched command pair is pending', () => {
    let now = 1_000;
    const suppressor = createClaudeUnifiedControlCommandEchoSuppressor({
      nowMs: () => now,
      stdoutFollowWindowMs: 1_000,
    });
    suppressor.recordTypedControlCommand('/effort medium');
    expect(suppressor.shouldSuppressTranscriptMessage(EFFORT_COMMAND_ROW)).toBe(true);

    // The follow window expires: a much later stdout row is not ours to hide.
    now += 5_000;
    expect(suppressor.shouldSuppressTranscriptMessage(EFFORT_STDOUT_ROW)).toBe(false);
  });
});
