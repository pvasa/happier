import { describe, it, expect } from 'vitest';

import { mapHermesSessionRow, type HermesSessionRow } from '@/backends/hermes/localControl/hermesSessionRowMapping';

const base: HermesSessionRow = {
  id: 1,
  role: 'assistant',
  content: null,
  toolCalls: null,
  toolCallId: null,
  toolName: null,
  reasoning: null,
  active: true,
};

describe('mapHermesSessionRow', () => {
  it('maps a user row to a single user-text action', () => {
    expect(mapHermesSessionRow({ ...base, id: 183, role: 'user', content: 'hello there' })).toEqual([
      { kind: 'user-text', text: 'hello there' },
    ]);
  });

  it('maps an assistant text row to an assistant-text action', () => {
    expect(mapHermesSessionRow({ ...base, id: 186, role: 'assistant', content: '👋 Hey!' })).toEqual([
      { kind: 'assistant-text', text: '👋 Hey!' },
    ]);
  });

  it('parses real Hermes tool_calls JSON into assistant-tool-calls', () => {
    const toolCalls =
      '[{"id": "call_0a1", "call_id": "call_0a1", "type": "function", "function": {"name": "mcp_happier_change_title", "arguments": "{\\"title\\": \\"Greeting\\"}"}}]';
    expect(mapHermesSessionRow({ ...base, id: 184, role: 'assistant', content: '', toolCalls })).toEqual([
      {
        kind: 'assistant-tool-calls',
        calls: [{ id: 'call_0a1', name: 'mcp_happier_change_title', argumentsJson: '{"title": "Greeting"}' }],
      },
    ]);
  });

  it('maps a tool result row to a tool-result action', () => {
    expect(
      mapHermesSessionRow({
        ...base,
        id: 185,
        role: 'tool',
        toolCallId: 'call_0a1',
        toolName: 'mcp_happier_change_title',
        content: '<untrusted_tool_result>ok</untrusted_tool_result>',
      }),
    ).toEqual([
      {
        kind: 'tool-result',
        toolCallId: 'call_0a1',
        toolName: 'mcp_happier_change_title',
        content: '<untrusted_tool_result>ok</untrusted_tool_result>',
      },
    ]);
  });

  it('emits reasoning before assistant text when both are present', () => {
    expect(
      mapHermesSessionRow({ ...base, role: 'assistant', reasoning: 'let me think', content: 'the answer' }),
    ).toEqual([
      { kind: 'reasoning', text: 'let me think' },
      { kind: 'assistant-text', text: 'the answer' },
    ]);
  });

  it('skips inactive rows', () => {
    expect(mapHermesSessionRow({ ...base, role: 'assistant', content: 'superseded', active: false })).toEqual([]);
  });

  it('skips empty assistant rows (no content, no tool calls)', () => {
    expect(mapHermesSessionRow({ ...base, role: 'assistant', content: '', toolCalls: null })).toEqual([]);
  });

  it('ignores malformed tool_calls JSON but still emits assistant text', () => {
    expect(
      mapHermesSessionRow({ ...base, role: 'assistant', content: 'hi', toolCalls: 'not json' }),
    ).toEqual([{ kind: 'assistant-text', text: 'hi' }]);
  });
});
