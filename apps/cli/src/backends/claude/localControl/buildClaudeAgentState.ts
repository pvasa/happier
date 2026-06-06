import { createAgentLocalControlState } from '@/agent/localControl/createAgentLocalControlState';
import type { AgentState } from '@/api/types';

type ClaudeControlMode = 'local' | 'remote';

export function buildClaudeAgentState(params: Readonly<{
    currentState: AgentState;
    mode: ClaudeControlMode;
    claudeUnifiedTerminalEnabled: boolean;
    localPermissionBridgeEnabled: boolean;
}>): AgentState {
    const currentCapabilities =
        params.currentState.capabilities && typeof params.currentState.capabilities === 'object'
            ? params.currentState.capabilities
            : {};
    const capabilities = {
        ...currentCapabilities,
        askUserQuestionAnswersInPermission: true,
        localPermissionBridgeInLocalMode: params.localPermissionBridgeEnabled,
        permissionsInUiWhileLocal: params.localPermissionBridgeEnabled,
    };

    if (params.claudeUnifiedTerminalEnabled) {
        return {
            ...params.currentState,
            controlledByUser: false,
            localControl: createAgentLocalControlState({
                attached: true,
                topology: 'shared',
                canAttach: true,
                canDetach: false,
                remoteWritable: true,
            }),
            capabilities: {
                ...capabilities,
                inFlightSteer: true,
                inFlightSteerSupported: true,
                inFlightSteerAvailable: true,
            },
        };
    }

    return {
        ...params.currentState,
        controlledByUser: params.mode === 'local',
        localControl: null,
        capabilities,
    };
}
