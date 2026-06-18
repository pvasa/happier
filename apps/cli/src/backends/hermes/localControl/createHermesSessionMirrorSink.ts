/**
 * Binds Hermes mirror actions to Happier session writes using the canonical
 * ACPMessageData shapes (the same literals OpenCode's runtime emits). Host user
 * text rides `sendUserTextMessage` (echo-suppressed by the default cli meta so
 * the agent is never re-prompted); assistant/thinking/tool messages ride
 * `sendAgentMessage('hermes', …)`. Tool calls and results correlate by `callId`.
 */
import { randomUUID } from 'node:crypto';

import type { ACPMessageData, ACPProvider } from '@/api/session/sessionMessageTypes';

import type { HermesMirrorSink } from './hermesMirrorSink';

export type HermesMirrorSessionWriter = Readonly<{
  sendUserTextMessage: (text: string, opts?: { localId?: string; meta?: Record<string, unknown> }) => void;
  sendAgentMessage: (
    provider: ACPProvider,
    body: ACPMessageData,
    opts?: { localId?: string; meta?: Record<string, unknown> },
  ) => void;
}>;

const HERMES_PROVIDER: ACPProvider = 'hermes';

export function createHermesSessionMirrorSink(params: Readonly<{
  session: HermesMirrorSessionWriter;
  newId?: () => string;
}>): HermesMirrorSink {
  const newId = params.newId ?? (() => randomUUID());
  const send = (body: ACPMessageData): void => params.session.sendAgentMessage(HERMES_PROVIDER, body);
  return {
    userText: (text) => params.session.sendUserTextMessage(text),
    assistantText: (text) => send({ type: 'message', message: text }),
    reasoning: (text) => send({ type: 'thinking', text }),
    toolCalls: (calls) => {
      for (const call of calls) {
        send({ type: 'tool-call', callId: call.id, name: call.name, input: parseToolInput(call.argumentsJson), id: newId() });
      }
    },
    toolResult: ({ toolCallId, content }) => send({ type: 'tool-result', callId: toolCallId, output: content, id: newId() }),
  };
}

function parseToolInput(argumentsJson: string): unknown {
  if (argumentsJson.trim().length === 0) return {};
  try {
    return JSON.parse(argumentsJson);
  } catch {
    return argumentsJson;
  }
}
