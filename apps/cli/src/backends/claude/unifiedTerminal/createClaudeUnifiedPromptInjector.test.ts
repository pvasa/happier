import { describe, expect, it, vi } from 'vitest';

import { createClaudeUnifiedPromptInjector } from './createClaudeUnifiedPromptInjector';

describe('createClaudeUnifiedPromptInjector', () => {
  it('injects Claude multiline prompts without bracketed paste markers', async () => {
    const injectUserPrompt = vi.fn().mockResolvedValue({
      status: 'injected',
      at: 123,
      bytesWritten: 17,
    });
    const injector = createClaudeUnifiedPromptInjector({
      inputInjection: {
        hostKind: 'tmux',
        injectUserPrompt,
      },
      createNonce: () => 'nonce-1',
    });

    await expect(
      injector.injectPrompt({
        message: 'alpha\nbeta',
        origin: { kind: 'ui_pending', clientId: 'client-1' },
      }),
    ).resolves.toMatchObject({ status: 'injected' });

    expect(injectUserPrompt).toHaveBeenCalledWith({
      text: 'alpha\nbeta',
      multiline: true,
      origin: {
        kind: 'ui_pending',
        clientId: 'client-1',
        nonce: 'nonce-1',
      },
      scheduling: {
        deferredUntilQuietMs: 800,
        timeoutMs: 15_000,
      },
    });
  });

  it('emits safe injection outcome telemetry without prompt text', async () => {
    const telemetry = { emit: vi.fn() };
    const injector = createClaudeUnifiedPromptInjector({
      inputInjection: {
        hostKind: 'zellij',
        injectUserPrompt: vi.fn().mockResolvedValue({
          status: 'failed',
          reason: 'pane_dead',
          phase: 'liveness',
          duplicateRisk: 'none',
          recoverable: false,
        }),
      },
      createNonce: () => 'nonce-1',
      telemetry,
    });

    await expect(
      injector.injectPrompt({
        message: 'secret prompt\nsecond line',
        origin: { kind: 'ui_pending', clientId: 'client-1' },
      }),
    ).resolves.toMatchObject({ status: 'failed', reason: 'pane_dead' });

    expect(telemetry.emit).toHaveBeenCalledWith({
      name: 'unified.injection.outcome',
      properties: {
        status: 'failed',
        reason: 'pane_dead',
        phase: 'liveness',
        duplicateRisk: 'none',
        recoverable: false,
        hostKind: 'zellij',
        multiline: true,
        originKind: 'ui_pending',
      },
    });
    expect(JSON.stringify(telemetry.emit.mock.calls)).not.toContain('secret prompt');
  });
});
