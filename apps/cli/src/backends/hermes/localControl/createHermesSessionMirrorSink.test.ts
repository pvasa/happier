import { describe, expect, it } from 'vitest';

import type { ACPMessageData } from '@/api/session/sessionMessageTypes';
import {
  createHermesSessionMirrorSink,
  type HermesMirrorSessionWriter,
} from '@/backends/hermes/localControl/createHermesSessionMirrorSink';

function recorder() {
  const userTexts: string[] = [];
  const agentWrites: Array<{ provider: string; body: ACPMessageData }> = [];
  const session: HermesMirrorSessionWriter = {
    sendUserTextMessage: (t) => userTexts.push(t),
    sendAgentMessage: (provider, body) => agentWrites.push({ provider, body }),
  };
  let n = 0;
  return { session, userTexts, agentWrites, newId: () => `id${(n += 1)}` };
}

describe('createHermesSessionMirrorSink', () => {
  it('sends host user text via sendUserTextMessage (echo-suppressed by default cli meta)', () => {
    const r = recorder();
    createHermesSessionMirrorSink({ session: r.session, newId: r.newId }).userText('ask something');
    expect(r.userTexts).toEqual(['ask something']);
    expect(r.agentWrites).toEqual([]);
  });

  it('sends assistant text as a message body and reasoning as a thinking body', () => {
    const r = recorder();
    const sink = createHermesSessionMirrorSink({ session: r.session, newId: r.newId });
    sink.reasoning('let me think');
    sink.assistantText('the answer');
    expect(r.agentWrites).toEqual([
      { provider: 'hermes', body: { type: 'thinking', text: 'let me think' } },
      { provider: 'hermes', body: { type: 'message', message: 'the answer' } },
    ]);
  });

  it('sends tool calls with parsed input and a fresh message id', () => {
    const r = recorder();
    createHermesSessionMirrorSink({ session: r.session, newId: r.newId }).toolCalls([
      { id: 'c1', name: 'change_title', argumentsJson: '{"title":"Greeting"}' },
    ]);
    expect(r.agentWrites).toEqual([
      {
        provider: 'hermes',
        body: { type: 'tool-call', callId: 'c1', name: 'change_title', input: { title: 'Greeting' }, id: 'id1' },
      },
    ]);
  });

  it('passes raw arguments string through when not valid JSON', () => {
    const r = recorder();
    createHermesSessionMirrorSink({ session: r.session, newId: r.newId }).toolCalls([
      { id: 'c1', name: 'do', argumentsJson: 'not json' },
    ]);
    expect((r.agentWrites[0].body as { input: unknown }).input).toBe('not json');
  });

  it('sends a tool result correlated by callId (separate message)', () => {
    const r = recorder();
    createHermesSessionMirrorSink({ session: r.session, newId: r.newId }).toolResult({
      toolCallId: 'c1',
      toolName: 'change_title',
      content: 'ok',
    });
    expect(r.agentWrites).toEqual([
      { provider: 'hermes', body: { type: 'tool-result', callId: 'c1', output: 'ok', id: 'id1' } },
    ]);
  });
});
