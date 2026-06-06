import { describe, expect, it } from 'vitest';

import {
  CLAUDE_LOCAL_PERMISSION_BRIDGE_REQUEST_SOURCE,
  getAgentMediaCapabilities,
  isClaudeLocalPermissionBridgeAgentStateRequest,
} from './index.js';
import {
  CLAUDE_LOCAL_PERMISSION_BRIDGE_REQUEST_SOURCE as CLAUDE_LOCAL_PERMISSION_BRIDGE_REQUEST_SOURCE_FROM_CLAUDE_INDEX,
  isClaudeLocalPermissionBridgeAgentStateRequest as isClaudeLocalPermissionBridgeAgentStateRequestFromClaudeIndex,
} from './providers/claude/index.js';

describe('agents package exports', () => {
  it('re-exports the Claude local permission bridge helper from the package root', () => {
    expect(CLAUDE_LOCAL_PERMISSION_BRIDGE_REQUEST_SOURCE).toBe('claude_local_permission_bridge');
    expect(isClaudeLocalPermissionBridgeAgentStateRequest({ source: CLAUDE_LOCAL_PERMISSION_BRIDGE_REQUEST_SOURCE })).toBe(true);
    expect(isClaudeLocalPermissionBridgeAgentStateRequest({ source: 'other' })).toBe(false);
  });

  it('re-exports the Claude local permission bridge helper from the Claude provider entrypoint', () => {
    expect(CLAUDE_LOCAL_PERMISSION_BRIDGE_REQUEST_SOURCE_FROM_CLAUDE_INDEX).toBe('claude_local_permission_bridge');
    expect(isClaudeLocalPermissionBridgeAgentStateRequestFromClaudeIndex({
      source: CLAUDE_LOCAL_PERMISSION_BRIDGE_REQUEST_SOURCE_FROM_CLAUDE_INDEX,
    })).toBe(true);
    expect(isClaudeLocalPermissionBridgeAgentStateRequestFromClaudeIndex({ source: 'other' })).toBe(false);
  });

  it('re-exports provider media capability helpers from the package root', () => {
    expect(getAgentMediaCapabilities('codex').nativeImageGeneration).toBe('supported');
  });
  it('re-exports Claude Code OAuth scope constants from the package root', async () => {
    const mod = await import('./index.js');

    expect(mod.CLAUDE_CODE_REQUIRED_OAUTH_SCOPES).toEqual([
      'user:inference',
      'user:profile',
      'user:sessions:claude_code',
    ]);
    expect(mod.CLAUDE_CODE_RECOMMENDED_OAUTH_SCOPES).toEqual([
      'user:inference',
      'user:profile',
      'user:sessions:claude_code',
      'user:mcp_servers',
      'user:file_upload',
    ]);
    expect(mod.CLAUDE_CODE_RECOMMENDED_OAUTH_SCOPE).toBe([
      'user:inference',
      'user:profile',
      'user:sessions:claude_code',
      'user:mcp_servers',
      'user:file_upload',
    ].join(' '));
  });
});
