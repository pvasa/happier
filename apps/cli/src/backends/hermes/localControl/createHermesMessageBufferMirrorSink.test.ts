import { describe, expect, it } from 'vitest';

import { MessageBuffer } from '@/ui/ink/messageBuffer';

import { applyHermesMirrorAction } from './hermesMirrorSink';
import { createHermesMessageBufferMirrorSink } from './createHermesMessageBufferMirrorSink';

describe('createHermesMessageBufferMirrorSink', () => {
  it('routes mirror actions into the message buffer with read-only display types', () => {
    const buffer = new MessageBuffer();
    const sink = createHermesMessageBufferMirrorSink(buffer);

    applyHermesMirrorAction(sink, { kind: 'user-text', text: 'hi' });
    applyHermesMirrorAction(sink, { kind: 'assistant-text', text: 'hello' });
    applyHermesMirrorAction(sink, { kind: 'reasoning', text: 'thinking' });
    applyHermesMirrorAction(sink, {
      kind: 'assistant-tool-calls',
      calls: [{ id: 'c1', name: 'bash', argumentsJson: '{"cmd":"ls"}' }],
    });
    applyHermesMirrorAction(sink, { kind: 'tool-result', toolCallId: 'c1', toolName: 'bash', content: 'file.txt' });

    const msgs = buffer.getMessages();
    expect(msgs.map((m) => m.type)).toEqual(['user', 'assistant', 'status', 'tool', 'result']);
    expect(msgs[0].content).toBe('hi');
    expect(msgs[1].content).toBe('hello');
    expect(msgs[3].content).toBe('bash {"cmd":"ls"}');
    expect(msgs[4].content).toBe('file.txt');
  });

  it('renders an argument-less tool call as the bare tool name', () => {
    const buffer = new MessageBuffer();
    const sink = createHermesMessageBufferMirrorSink(buffer);
    applyHermesMirrorAction(sink, { kind: 'assistant-tool-calls', calls: [{ id: 'c2', name: 'now', argumentsJson: '' }] });
    expect(buffer.getMessages()[0].content).toBe('now');
  });
});
