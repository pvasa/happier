import { describe, expect, it } from 'vitest';

describe('provider-native permission mode mapping', () => {
    it('maps canonical Claude permission intents to Claude SDK permission modes', async () => {
        const permissions = await import('./index.js') as Record<string, any>;
        const resolveProviderNativePermissionModeForAgent = permissions.resolveProviderNativePermissionModeForAgent;

        expect(resolveProviderNativePermissionModeForAgent).toEqual(expect.any(Function));
        expect(resolveProviderNativePermissionModeForAgent({ agentId: 'claude', mode: 'safe-yolo' })).toBe('auto');
        expect(resolveProviderNativePermissionModeForAgent({ agentId: 'claude', mode: 'read-only' })).toBe('dontAsk');
        expect(resolveProviderNativePermissionModeForAgent({ agentId: 'claude', mode: 'yolo' })).toBe('bypassPermissions');
    });

    it('keeps codex-like provider modes canonical', async () => {
        const permissions = await import('./index.js') as Record<string, any>;
        const resolveProviderNativePermissionModeForAgent = permissions.resolveProviderNativePermissionModeForAgent;

        expect(resolveProviderNativePermissionModeForAgent).toEqual(expect.any(Function));
        expect(resolveProviderNativePermissionModeForAgent({ agentId: 'codex', mode: 'safe-yolo' })).toBe('safe-yolo');
        expect(resolveProviderNativePermissionModeForAgent({ agentId: 'codex', mode: 'read-only' })).toBe('read-only');
    });
});
