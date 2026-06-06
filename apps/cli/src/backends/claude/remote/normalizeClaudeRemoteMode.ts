import type { EnhancedMode } from '@/backends/claude/loop';

export type NormalizedClaudeRemoteModeKind = 'unifiedTerminal' | 'agentSdk' | 'legacy';

export type NormalizedClaudeRemoteMode = Readonly<{
    kind: NormalizedClaudeRemoteModeKind;
}>;

export function normalizeClaudeRemoteMode(mode: Pick<EnhancedMode, 'claudeRemoteAgentSdkEnabled' | 'claudeUnifiedTerminalEnabled'>): NormalizedClaudeRemoteMode {
    if (mode.claudeUnifiedTerminalEnabled === true) {
        return { kind: 'unifiedTerminal' };
    }
    if (mode.claudeRemoteAgentSdkEnabled === false) {
        return { kind: 'legacy' };
    }
    return { kind: 'agentSdk' };
}
