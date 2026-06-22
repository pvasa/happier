import {
    SESSION_MESSAGE_USER_ATTENTION_IMPACT,
    TranscriptRawRecordV1Schema,
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

export function storedSessionMessageContentAttentionImpactOrNull(content: unknown): SessionMessageAttentionImpact | null {
    if (content && typeof content === 'object' && (content as { t?: unknown }).t === 'encrypted') {
        return null;
    }

    if (!content || typeof content !== 'object' || (content as { t?: unknown }).t !== 'plain') {
        return SESSION_MESSAGE_USER_ATTENTION_IMPACT;
    }

    const parsed = TranscriptRawRecordV1Schema.safeParse((content as { v?: unknown }).v);
    if (!parsed.success) {
        return SESSION_MESSAGE_USER_ATTENTION_IMPACT;
    }

    if (parsed.data.role === 'agent' && parsed.data.content.type === 'event') {
        return agentEventAttentionImpact(parsed.data.content.data);
    }

    return SESSION_MESSAGE_USER_ATTENTION_IMPACT;
}

export function storedSessionMessageContentAttentionImpact(content: unknown): SessionMessageAttentionImpact {
    return storedSessionMessageContentAttentionImpactOrNull(content) ?? SESSION_MESSAGE_USER_ATTENTION_IMPACT;
}
