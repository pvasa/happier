export const SESSION_LIST_ATTENTION_PROMOTION_MODE_VALUES = ['off', 'global', 'withinGroups'] as const;

export type SessionListAttentionPromotionMode = typeof SESSION_LIST_ATTENTION_PROMOTION_MODE_VALUES[number];

export type SessionListAttentionPromotionReason =
    | 'action_required'
    | 'permission_required'
    | 'failed'
    | 'ready';

export function normalizeSessionListAttentionPromotionMode(value: unknown): SessionListAttentionPromotionMode {
    return value === 'global' || value === 'withinGroups' ? value : 'off';
}
