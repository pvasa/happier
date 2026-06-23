/**
 * A {@link HermesMirrorSink} that renders mirror actions into an in-process
 * {@link MessageBuffer} for the host's read-only remote-mode display.
 *
 * While the phone drives a Hermes session, the daemon-spawned `hermes acp`
 * runtime executes the agent and writes to `state.db`. The host tails the same
 * rows and reflects them here, so its terminal can show the conversation
 * read-only without running a second runtime (mirrors codex's read-only
 * RemoteControlDisplay surface, but fed from the state.db mirror instead of an
 * in-process message buffer).
 */
import type { MessageBuffer } from '@/ui/ink/messageBuffer';

import type { HermesMirrorSink } from './hermesMirrorSink';

export function createHermesMessageBufferMirrorSink(buffer: MessageBuffer): HermesMirrorSink {
  return {
    userText: (text) => buffer.addMessage(text, 'user'),
    assistantText: (text) => buffer.addMessage(text, 'assistant'),
    reasoning: (text) => buffer.addMessage(text, 'status'),
    toolCalls: (calls) => {
      for (const call of calls) {
        const args = call.argumentsJson.trim();
        buffer.addMessage(args.length > 0 ? `${call.name} ${args}` : call.name, 'tool');
      }
    },
    toolResult: ({ content }) => buffer.addMessage(content, 'result'),
  };
}
