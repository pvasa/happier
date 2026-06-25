import { describe, expect, it } from 'vitest';

import { computeLocalPermissionPolicyDecision } from './permissionPolicyDecision';

function decide(mode: Parameters<typeof computeLocalPermissionPolicyDecision>[0]['mode'], toolName: string) {
    return computeLocalPermissionPolicyDecision({ mode, toolName });
}

describe('computeLocalPermissionPolicyDecision', () => {
    describe('safe-yolo (Auto) is pass-through to Claude\'s native engine', () => {
        it('relays every escalation to the UI, regardless of tool kind', () => {
            // Claude only escalates genuine asks; Happier relays them rather than auto-approving.
            expect(decide('safe-yolo', 'Read')).toBe('prompt');
            expect(decide('safe-yolo', 'Bash')).toBe('prompt');
            expect(decide('safe-yolo', 'Write')).toBe('prompt');
            expect(decide('safe-yolo', 'Edit')).toBe('prompt');
        });

        it('still auto-allows the internal change-title tool', () => {
            expect(decide('safe-yolo', 'change_title')).toBe('allow');
        });
    });

    describe('deterministic modes still decided locally', () => {
        it('yolo allows everything', () => {
            expect(decide('yolo', 'Write')).toBe('allow');
            expect(decide('yolo', 'Bash')).toBe('allow');
        });

        it('read-only allows reads and denies writes by tool name', () => {
            expect(decide('read-only', 'Read')).toBe('allow');
            expect(decide('read-only', 'Grep')).toBe('allow');
            expect(decide('read-only', 'Write')).toBe('deny');
            expect(decide('read-only', 'Bash')).toBe('deny');
        });
    });

    describe('default / plan relay like Auto (native mode differs, policy does not)', () => {
        it('relays to the UI', () => {
            expect(decide('default', 'Read')).toBe('prompt');
            expect(decide('plan', 'Bash')).toBe('prompt');
        });
    });
});
