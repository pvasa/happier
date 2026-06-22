import { describe, expect, it } from 'vitest';

import {
  TERMINAL_INPUT_BASE_PROVIDER_ACCEPTANCE_TIMEOUT_MS,
  TERMINAL_INPUT_MAX_PROVIDER_ACCEPTANCE_TIMEOUT_MS,
  TERMINAL_INPUT_MAX_WRITE_TIMEOUT_MS,
  resolveTerminalPromptProviderAcceptanceTimeoutMs,
  resolveTerminalPromptWriteTimeoutMs,
} from './promptWriteTimeout';

describe('resolveTerminalPromptWriteTimeoutMs', () => {
  it('keeps the base timeout for ordinary prompts', () => {
    expect(resolveTerminalPromptWriteTimeoutMs('hello', { baseTimeoutMs: 15_000 })).toBe(15_000);
  });

  it('scales the timeout for large terminal prompts', () => {
    expect(resolveTerminalPromptWriteTimeoutMs('x'.repeat(128_000), { baseTimeoutMs: 15_000 })).toBeGreaterThan(15_000);
  });

  it('caps the timeout for pathological prompt sizes', () => {
    expect(resolveTerminalPromptWriteTimeoutMs('x'.repeat(5_000_000))).toBe(TERMINAL_INPUT_MAX_WRITE_TIMEOUT_MS);
  });
});

describe('resolveTerminalPromptProviderAcceptanceTimeoutMs', () => {
  it('keeps the base timeout for ordinary prompts', () => {
    expect(resolveTerminalPromptProviderAcceptanceTimeoutMs('hello')).toBe(TERMINAL_INPUT_BASE_PROVIDER_ACCEPTANCE_TIMEOUT_MS);
  });

  it('scales the provider acceptance timeout for large terminal prompts', () => {
    expect(resolveTerminalPromptProviderAcceptanceTimeoutMs('x'.repeat(128_000))).toBeGreaterThan(
      TERMINAL_INPUT_BASE_PROVIDER_ACCEPTANCE_TIMEOUT_MS,
    );
  });

  it('uses the terminal-reported byte count when available', () => {
    expect(resolveTerminalPromptProviderAcceptanceTimeoutMs('short', { bytesWritten: 128_000 })).toBeGreaterThan(
      TERMINAL_INPUT_BASE_PROVIDER_ACCEPTANCE_TIMEOUT_MS,
    );
  });

  it('caps the timeout for pathological prompt sizes', () => {
    expect(resolveTerminalPromptProviderAcceptanceTimeoutMs('x'.repeat(5_000_000))).toBe(
      TERMINAL_INPUT_MAX_PROVIDER_ACCEPTANCE_TIMEOUT_MS,
    );
  });
});
