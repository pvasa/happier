import { describe, expect, it } from 'vitest';

import {
  TranscriptRawAgentEventV1Schema,
  TranscriptRawRecordV1Schema,
} from './transcriptRawRecordV1.js';

describe('TranscriptRawRecordV1Schema', () => {
  it('parses user text records with extra fields', () => {
    const parsed = TranscriptRawRecordV1Schema.safeParse({
      role: 'user',
      content: { type: 'text', text: 'hello', extra: true },
      meta: { source: 'ui', model: null },
      unknownTopLevel: { ok: true },
    });

    expect(parsed.success).toBe(true);
  });

  it('parses agent output records with unknown output data types', () => {
    const parsed = TranscriptRawRecordV1Schema.safeParse({
      role: 'agent',
      content: {
        type: 'output',
        data: {
          type: 'opaque_future_type',
          anything: { nested: true },
        },
      },
    });

    expect(parsed.success).toBe(true);
  });

  it('accepts hyphenated tool-call blocks (normalized later)', () => {
    const parsed = TranscriptRawRecordV1Schema.safeParse({
      role: 'agent',
      content: {
        type: 'output',
        data: {
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [
              {
                type: 'tool-call',
                callId: 'call_1',
                name: 'Bash',
                input: { cmd: 'echo hi' },
              },
            ],
          },
        },
      },
    });

    expect(parsed.success).toBe(true);
  });

  it('parses acp records with unknown data types (forward compatibility)', () => {
    const parsed = TranscriptRawRecordV1Schema.safeParse({
      role: 'agent',
      content: {
        type: 'acp',
        provider: 'future-provider',
        data: {
          type: 'some_future_event',
          any: { payload: true },
        },
      },
    });

    expect(parsed.success).toBe(true);
  });

  it('parses codex turn_aborted lifecycle records', () => {
    const parsed = TranscriptRawRecordV1Schema.safeParse({
      role: 'agent',
      content: {
        type: 'codex',
        data: {
          type: 'turn_aborted',
        },
      },
    });

    expect(parsed.success).toBe(true);
  });

  it('parses legacy codex tool-result sidechain records', () => {
    const parsed = TranscriptRawRecordV1Schema.safeParse({
      role: 'agent',
      content: {
        type: 'codex',
        data: {
          type: 'tool-result',
          callId: 'call_child_1',
          id: 'tool-result-legacy-1',
          output: 'ok',
          sidechainId: 'thread-child',
        },
      },
    });

    expect(parsed.success).toBe(true);
  });

  it('parses codex terminal primary turn lifecycle records', () => {
    for (const type of ['turn_failed', 'turn_cancelled', 'turn_aborted'] as const) {
      const parsed = TranscriptRawRecordV1Schema.safeParse({
        role: 'agent',
        content: {
          type: 'codex',
          data: {
            type,
          },
        },
      });

      expect(parsed.success).toBe(true);
    }
  });

  it('parses acp terminal primary turn lifecycle records', () => {
    for (const type of ['turn_failed', 'turn_cancelled', 'turn_aborted'] as const) {
      const parsed = TranscriptRawRecordV1Schema.safeParse({
        role: 'agent',
        content: {
          type: 'acp',
          provider: 'claude',
          data: {
            type,
            id: 'turn_1',
          },
        },
      });

      expect(parsed.success).toBe(true);
    }
  });

  it('parses canonical context compaction records including cancellation and retry attempt metadata', () => {
    const parsed = TranscriptRawRecordV1Schema.safeParse({
      role: 'agent',
      content: {
        type: 'event',
        id: 'event-compact-cancelled',
        data: {
          type: 'context-compaction',
          phase: 'cancelled',
          source: 'provider-event',
          lifecycleId: 'compact_1',
          tokenCountBefore: 1200,
          tokenCountAfter: 320,
          retryAttempt: 2,
          sanitizedErrorPreview: 'cancelled by provider',
        },
      },
    });

    expect(parsed.success).toBe(true);
    if (parsed.success && parsed.data.content.type === 'event') {
      expect(parsed.data.content.data).toMatchObject({
        type: 'context-compaction',
        phase: 'cancelled',
        retryAttempt: 2,
      });
    }
  });

  it('parses connected-service account switch deferral observability events', () => {
    const deferred = TranscriptRawRecordV1Schema.safeParse({
      role: 'agent',
      content: {
        type: 'event',
        id: 'event-switch-deferral',
        data: {
          type: 'connected-service-account-switch-deferral',
          policy: 'defer_until_turn_boundary',
          awaitingBoundary: true,
          timeoutMs: 60_000,
        },
      },
    });
    expect(deferred.success).toBe(true);

    const completed = TranscriptRawRecordV1Schema.safeParse({
      role: 'agent',
      content: {
        type: 'event',
        id: 'event-switch-deferral-completed',
        data: {
          type: 'connected-service-account-switch-deferral-completed',
          policy: 'defer_until_turn_boundary',
          reason: 'completed_at_boundary',
        },
      },
    });
    expect(completed.success).toBe(true);
  });

  it('parses paused continuation metadata for completed context compaction records', () => {
    const parsed = TranscriptRawRecordV1Schema.safeParse({
      role: 'agent',
      content: {
        type: 'event',
        id: 'event-compact-paused',
        data: {
          type: 'context-compaction',
          phase: 'completed',
          source: 'provider-event',
          continuation: 'paused',
          pauseReason: 'provider-idle-after-compaction',
        },
      },
    });

    expect(parsed.success).toBe(true);
    if (parsed.success && parsed.data.content.type === 'event') {
      expect(parsed.data.content.data).toMatchObject({
        type: 'context-compaction',
        phase: 'completed',
        continuation: 'paused',
        pauseReason: 'provider-idle-after-compaction',
      });
    }
  });

  it('rejects invalid context compaction continuation metadata', () => {
    const invalidEvents = [
      {
        id: 'event-compact-invalid-continuation',
        data: {
          continuation: 'stopped',
          pauseReason: 'provider-idle-after-compaction',
        },
      },
      {
        id: 'event-compact-invalid-pause-reason',
        data: {
          continuation: 'paused',
          pauseReason: 'provider-timeout',
        },
      },
      {
        id: 'event-compact-paused-non-completed-phase',
        data: {
          phase: 'failed',
          continuation: 'paused',
          pauseReason: 'provider-idle-after-compaction',
        },
      },
      {
        id: 'event-compact-pause-reason-without-continuation',
        data: {
          pauseReason: 'provider-idle-after-compaction',
        },
      },
    ];

    for (const event of invalidEvents) {
      const parsed = TranscriptRawRecordV1Schema.safeParse({
        role: 'agent',
        content: {
          type: 'event',
          id: event.id,
          data: {
            type: 'context-compaction',
            phase: 'completed',
            ...event.data,
          },
        },
      });

      expect(parsed.success).toBe(false);
    }
  });

  it('rejects inconsistent paused metadata in standalone context compaction events', () => {
    expect(TranscriptRawAgentEventV1Schema.safeParse({
      type: 'context-compaction',
      phase: 'failed',
      continuation: 'paused',
      pauseReason: 'provider-idle-after-compaction',
    }).success).toBe(false);
  });

  it('normalizes legacy detected context compaction phase to completed', () => {
    const parsed = TranscriptRawRecordV1Schema.safeParse({
      role: 'agent',
      content: {
        type: 'event',
        id: 'event-compact-detected',
        data: {
          type: 'context-compaction',
          phase: 'detected',
          source: 'transcript-inference',
        },
      },
    });

    expect(parsed.success).toBe(true);
    if (parsed.success && parsed.data.content.type === 'event') {
      expect(parsed.data.content.data).toMatchObject({
        type: 'context-compaction',
        phase: 'completed',
        source: 'transcript-inference',
      });
    }
  });

  it('parses connected-service account switch events', () => {
    const parsed = TranscriptRawRecordV1Schema.safeParse({
      role: 'agent',
      content: {
        type: 'event',
        id: 'event-account-switch',
        data: {
          type: 'connected-service-account-switch',
          serviceId: 'openai-codex',
          groupId: 'codex-main',
          fromProfileId: 'work',
          toProfileId: 'backup',
          reason: 'usage_limit',
          mode: 'hot_apply',
          resetAtMs: 1_000,
          effectiveRemainingPct: 12,
        },
      },
    });

    expect(parsed.success).toBe(true);
  });

  it('parses connected-service account switch events with native endpoints', () => {
    const parsed = TranscriptRawRecordV1Schema.safeParse({
      role: 'agent',
      content: {
        type: 'event',
        id: 'event-account-switch-native-to-connected',
        data: {
          type: 'connected-service-account-switch',
          serviceId: 'openai-codex',
          groupId: 'happier',
          fromProfileId: null,
          toProfileId: 'team',
          reason: 'manual',
          mode: 'restart_resume',
        },
      },
    });

    expect(parsed.success).toBe(true);
  });

  it('parses connected-service account switch attempt events', () => {
    const parsed = TranscriptRawRecordV1Schema.safeParse({
      role: 'agent',
      content: {
        type: 'event',
        id: 'event-account-switch-attempt',
        data: {
          type: 'connected-service-account-switch-attempt',
          ok: false,
          action: 'restart_requested',
          errorCode: 'post_switch_recovery_failed',
          partialState: 'runtime_auth_applied',
        },
      },
    });

    expect(parsed.success).toBe(true);
  });

  it('parses provider state-sharing degraded events', () => {
    const parsed = TranscriptRawRecordV1Schema.safeParse({
      role: 'agent',
      content: {
        type: 'event',
        id: 'event-provider-state-sharing-degraded',
        data: {
          type: 'provider-state-sharing-degraded',
          serviceId: 'anthropic',
          requestedStateMode: 'shared',
          effectiveStateMode: 'isolated',
          code: 'state_symlink_unavailable',
        },
      },
    });

    expect(parsed.success).toBe(true);
  });

  it('parses provider quota wait and recovered events', () => {
    const wait = TranscriptRawRecordV1Schema.safeParse({
      role: 'agent',
      content: {
        type: 'event',
        id: 'event-quota-wait',
        data: {
          type: 'provider-quota-wait',
          serviceId: 'openai-codex',
          profileId: 'work',
          groupId: 'codex-main',
          resetAtMs: 1_000,
          reason: 'usage_limit',
        },
      },
    });
    const recovered = TranscriptRawRecordV1Schema.safeParse({
      role: 'agent',
      content: {
        type: 'event',
        id: 'event-quota-recovered',
        data: {
          type: 'provider-quota-recovered',
          serviceId: 'openai-codex',
          profileId: 'work',
          groupId: 'codex-main',
          reason: 'reset_confirmed',
        },
      },
    });

    expect(wait.success).toBe(true);
    expect(recovered.success).toBe(true);
  });

  it('parses assistant content blocks with unknown types (forward compatibility)', () => {
    const parsed = TranscriptRawRecordV1Schema.safeParse({
      role: 'agent',
      content: {
        type: 'output',
        data: {
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [
              { type: 'text', text: 'hello' },
              { type: 'new_block_type', payload: { ok: true } },
            ],
          },
        },
      },
    });

    expect(parsed.success).toBe(true);
  });

  it('does not drop messages when usage shape changes (invalid usage is ignored)', () => {
    const parsed = TranscriptRawRecordV1Schema.safeParse({
      role: 'agent',
      content: {
        type: 'output',
        data: {
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'hello' }],
            usage: {
              // Missing required token counts for our structured usage parser.
              output_tokens: 5,
              something_new: true,
            },
          },
        },
      },
    });

    expect(parsed.success).toBe(true);
    expect((parsed.success ? (parsed.data as any).content.data.message.usage : null)).toBeUndefined();
  });
});
