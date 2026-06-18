import { describe, expect, it } from 'vitest';

import { applyHermesMirrorAction, type HermesMirrorSink } from '@/backends/hermes/localControl/hermesMirrorSink';

function recordingSink(): { sink: HermesMirrorSink; calls: Array<readonly [string, unknown]> } {
  const calls: Array<readonly [string, unknown]> = [];
  const sink: HermesMirrorSink = {
    userText: (t) => calls.push(['userText', t]),
    assistantText: (t) => calls.push(['assistantText', t]),
    reasoning: (t) => calls.push(['reasoning', t]),
    toolCalls: (c) => calls.push(['toolCalls', c]),
    toolResult: (p) => calls.push(['toolResult', p]),
  };
  return { sink, calls };
}

describe('applyHermesMirrorAction', () => {
  it('routes user text to the sink', () => {
    const { sink, calls } = recordingSink();
    applyHermesMirrorAction(sink, { kind: 'user-text', text: 'hi' });
    expect(calls).toEqual([['userText', 'hi']]);
  });

  it('routes assistant text and reasoning', () => {
    const { sink, calls } = recordingSink();
    applyHermesMirrorAction(sink, { kind: 'reasoning', text: 'thinking' });
    applyHermesMirrorAction(sink, { kind: 'assistant-text', text: 'answer' });
    expect(calls).toEqual([
      ['reasoning', 'thinking'],
      ['assistantText', 'answer'],
    ]);
  });

  it('routes tool calls and tool results with their fields', () => {
    const { sink, calls } = recordingSink();
    applyHermesMirrorAction(sink, {
      kind: 'assistant-tool-calls',
      calls: [{ id: 'c1', name: 'do', argumentsJson: '{}' }],
    });
    applyHermesMirrorAction(sink, {
      kind: 'tool-result',
      toolCallId: 'c1',
      toolName: 'do',
      content: 'done',
    });
    expect(calls).toEqual([
      ['toolCalls', [{ id: 'c1', name: 'do', argumentsJson: '{}' }]],
      ['toolResult', { toolCallId: 'c1', toolName: 'do', content: 'done' }],
    ]);
  });
});
