import { describe, expect, it } from 'vitest';

import { buildClaudeAgentState } from './buildClaudeAgentState';

describe('buildClaudeAgentState', () => {
  it('publishes unified terminal sessions as shared and remote-writable instead of locally controlled', () => {
    expect(buildClaudeAgentState({
      currentState: {
        capabilities: {
          inFlightSteer: true,
        },
      },
      mode: 'remote',
      claudeUnifiedTerminalEnabled: true,
      localPermissionBridgeEnabled: true,
    })).toMatchObject({
      controlledByUser: false,
      localControl: {
        attached: true,
        topology: 'shared',
        remoteWritable: true,
        canAttach: true,
        canDetach: false,
      },
      capabilities: {
        inFlightSteer: true,
        inFlightSteerSupported: true,
        inFlightSteerAvailable: true,
        askUserQuestionAnswersInPermission: true,
        localPermissionBridgeInLocalMode: true,
        permissionsInUiWhileLocal: true,
      },
    });
  });

  it('preserves legacy Claude local-control semantics when unified terminal is disabled', () => {
    expect(buildClaudeAgentState({
      currentState: {
        localControl: {
          attached: true,
          topology: 'shared',
          remoteWritable: true,
        },
      },
      mode: 'local',
      claudeUnifiedTerminalEnabled: false,
      localPermissionBridgeEnabled: false,
    })).toMatchObject({
      controlledByUser: true,
      localControl: null,
      capabilities: {
        askUserQuestionAnswersInPermission: true,
        localPermissionBridgeInLocalMode: false,
        permissionsInUiWhileLocal: false,
      },
    });
  });
});
