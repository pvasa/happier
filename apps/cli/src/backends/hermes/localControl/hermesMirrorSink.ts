/**
 * Output port for the Hermes session mirror. `applyHermesMirrorAction` routes a
 * mapped mirror action to the sink; a concrete sink binds these to Happier
 * session writes (see `createHermesSessionMirrorSink`). Keeping the port
 * separate lets the routing be tested without a live session and isolates the
 * session-write boundary.
 */
import type { HermesMirrorAction, HermesMirrorToolCall } from './hermesSessionRowMapping';

export type HermesMirrorSink = Readonly<{
  userText: (text: string) => void;
  assistantText: (text: string) => void;
  reasoning: (text: string) => void;
  toolCalls: (calls: ReadonlyArray<HermesMirrorToolCall>) => void;
  toolResult: (params: Readonly<{ toolCallId: string; toolName: string | null; content: string }>) => void;
}>;

export function applyHermesMirrorAction(sink: HermesMirrorSink, action: HermesMirrorAction): void {
  switch (action.kind) {
    case 'user-text':
      sink.userText(action.text);
      return;
    case 'assistant-text':
      sink.assistantText(action.text);
      return;
    case 'reasoning':
      sink.reasoning(action.text);
      return;
    case 'assistant-tool-calls':
      sink.toolCalls(action.calls);
      return;
    case 'tool-result':
      sink.toolResult({ toolCallId: action.toolCallId, toolName: action.toolName, content: action.content });
      return;
    default: {
      const exhaustive: never = action;
      return exhaustive;
    }
  }
}
