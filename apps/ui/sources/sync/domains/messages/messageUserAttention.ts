import {
    SESSION_MESSAGE_USER_ATTENTION_IMPACT,
    agentEventAttentionImpact,
    type SessionMessageAttentionImpact,
} from '@happier-dev/protocol';

import type { Message } from './messageTypes';

export function messageAttentionImpact(
    message: Pick<Message, 'kind'> & Partial<Pick<Extract<Message, { kind: 'agent-event' }>, 'event'>>,
): SessionMessageAttentionImpact {
    if (message.kind !== 'agent-event') return SESSION_MESSAGE_USER_ATTENTION_IMPACT;
    return agentEventAttentionImpact(message.event ?? null);
}
