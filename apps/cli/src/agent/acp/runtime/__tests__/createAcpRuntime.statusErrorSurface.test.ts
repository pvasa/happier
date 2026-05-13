import { describe, expect, it } from 'vitest';

import { MessageBuffer } from '@/ui/ink/messageBuffer';
import type { AgentMessage } from '@/agent/core/AgentMessage';
import type { ACPMessageData } from '@/api/session/sessionMessageTypes';

import { createAcpRuntime } from '../createAcpRuntime';
import { createFakeAcpRuntimeBackend } from '@/testkit/backends/acpRuntimeBackend';
import { createApprovedPermissionHandler } from '@/testkit/backends/permissionHandler';
import { createBasicSessionClientWithOverrides } from '@/testkit/backends/sessionFixtures';

describe('createAcpRuntime (status error surfacing)', () => {
  it('surfaces non-abort status:error as sanitized primary-session failure', async () => {
    const backend = createFakeAcpRuntimeBackend({ sessionId: 'sess_main' });

    const sent: ACPMessageData[] = [];
    const runtimeUpdates: unknown[] = [];
    const session = {
      ...createBasicSessionClientWithOverrides({
        sendAgentMessage: (_provider, body) => {
          sent.push(body);
        },
      }),
      updatePrimaryTurnRuntimeState: async (record: unknown) => {
        runtimeUpdates.push(record);
      },
    };

    const runtime = createAcpRuntime({
      provider: 'pi',
      directory: '/tmp',
      session,
      messageBuffer: new MessageBuffer(),
      mcpServers: {},
      permissionHandler: createApprovedPermissionHandler(),
      onThinkingChange: () => {},
      ensureBackend: async () => backend,
    });

    await runtime.startOrLoad({});
    runtime.beginTurn();

    backend.emit({ type: 'status', status: 'error', detail: 'Model not found.' } satisfies AgentMessage);
    await Promise.resolve();
    await Promise.resolve();

    expect(sent.some((msg) => msg.type === 'message' && msg.message.includes('Model not found'))).toBe(false);
    expect(sent.some((msg) => msg.type === 'turn_failed')).toBe(true);
    expect(sent.some((msg) => msg.type === 'turn_aborted')).toBe(false);
    expect(runtimeUpdates).toEqual([
      expect.objectContaining({
        latestTurnStatus: 'failed',
        lastRuntimeIssue: expect.objectContaining({
          source: 'provider_status_error',
          sanitizedPreview: 'Provider reported an error',
        }),
      }),
    ]);
    expect(JSON.stringify(runtimeUpdates)).not.toContain('Model not found');
  });

  it('does not surface abort-like status:error detail as a transcript message', async () => {
    const backend = createFakeAcpRuntimeBackend({ sessionId: 'sess_main' });

    const sent: ACPMessageData[] = [];
    const session = createBasicSessionClientWithOverrides({
      sendAgentMessage: (_provider, body) => {
        sent.push(body);
      },
    });

    const runtime = createAcpRuntime({
      provider: 'opencode',
      directory: '/tmp',
      session,
      messageBuffer: new MessageBuffer(),
      mcpServers: {},
      permissionHandler: createApprovedPermissionHandler(),
      onThinkingChange: () => {},
      ensureBackend: async () => backend,
    });

    await runtime.startOrLoad({});
    runtime.beginTurn();

    backend.emit({
      type: 'status',
      status: 'error',
      detail: 'Error: OpenCode session aborted\n    at Object.cancel (/tmp/runtime.ts:10:1)',
    } satisfies AgentMessage);
    await Promise.resolve();
    await Promise.resolve();

    expect(sent.some((msg) => msg.type === 'message' && msg.message.includes('OpenCode session aborted'))).toBe(false);
    expect(sent.some((msg) => msg.type === 'message' && msg.message.includes('at Object.cancel'))).toBe(false);
    expect(sent.some((msg) => msg.type === 'turn_aborted')).toBe(true);
  });
});
