/**
 * Hermes ACP Backend - Nous Research Hermes agent via ACP.
 *
 * Hermes must be installed and available in PATH.
 * ACP mode: `hermes acp`
 *
 * Hermes ships a complete ACP server launched by the bare `hermes acp`
 * command. It takes no extra CLI flags and its stdout/stderr discipline
 * matches the generic `DefaultTransport`, so no custom transport is needed.
 */

import { AcpBackend, type AcpBackendOptions, type AcpPermissionHandler } from '@/agent/acp/AcpBackend';
import type { AgentBackend, AgentFactoryOptions, McpServerConfig } from '@/agent/core';
import type { PermissionMode } from '@/api/types';
import { requireProviderCliLaunchSpec } from '@/runtime/managedTools/requireProviderCliLaunchSpec';

export interface HermesBackendOptions extends AgentFactoryOptions {
  mcpServers?: Record<string, McpServerConfig>;
  permissionHandler?: AcpPermissionHandler;
  permissionMode?: PermissionMode;
}

export function createHermesBackend(options: HermesBackendOptions): AgentBackend {
  const processEnv = { ...process.env, ...options.env };
  const launch = requireProviderCliLaunchSpec('hermes', { processEnv });

  const backendOptions: AcpBackendOptions = {
    agentName: 'hermes',
    cwd: options.cwd,
    command: launch.command,
    args: [...launch.args, 'acp'],
    env: {
      ...options.env,
      // Keep output clean; ACP must own stdout.
      NODE_ENV: 'production',
      DEBUG: '',
    },
    mcpServers: options.mcpServers,
    permissionHandler: options.permissionHandler,
    // Generic transport: Hermes' stdio discipline matches DefaultTransport.
  };

  return new AcpBackend(backendOptions);
}
