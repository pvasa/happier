import { Buffer } from 'node:buffer';

import { TERMINAL_INPUT_MAX_WAIT_MS } from './arbiter';

export const TERMINAL_INPUT_MAX_WRITE_TIMEOUT_MS = 300_000;
export const TERMINAL_INPUT_BASE_PROVIDER_ACCEPTANCE_TIMEOUT_MS = 5_000;
export const TERMINAL_INPUT_MAX_PROVIDER_ACCEPTANCE_TIMEOUT_MS = 180_000;

const WRITE_TIMEOUT_BYTES_PER_SECOND = 1_024;
const WRITE_TIMEOUT_NEWLINE_OVERHEAD_MS = 50;
const PROVIDER_ACCEPTANCE_BYTES_PER_SECOND = 2_048;

export type TerminalPromptWriteBudget = Readonly<{
  timeoutMs: number;
  byteLength: number;
  newlineCount: number;
  byteBudgetMs: number;
  newlineBudgetMs: number;
}>;

export function resolveTerminalPromptWriteBudget(
  text: string,
  opts?: Readonly<{
    baseTimeoutMs?: number | undefined;
    maxTimeoutMs?: number | undefined;
  }>,
): TerminalPromptWriteBudget {
  const baseTimeoutMs = Math.max(1, Math.trunc(opts?.baseTimeoutMs ?? TERMINAL_INPUT_MAX_WAIT_MS));
  const maxTimeoutMs = Math.max(baseTimeoutMs, Math.trunc(opts?.maxTimeoutMs ?? TERMINAL_INPUT_MAX_WRITE_TIMEOUT_MS));
  const byteLength = Buffer.byteLength(text, 'utf8');
  const newlineCount = text.length === 0 ? 0 : text.split('\n').length - 1;
  const byteBudgetMs = Math.ceil(byteLength / WRITE_TIMEOUT_BYTES_PER_SECOND) * 1_000;
  const newlineBudgetMs = newlineCount * WRITE_TIMEOUT_NEWLINE_OVERHEAD_MS;
  const resolved = Math.max(baseTimeoutMs, byteBudgetMs + newlineBudgetMs);
  return {
    timeoutMs: Math.min(maxTimeoutMs, resolved),
    byteLength,
    newlineCount,
    byteBudgetMs,
    newlineBudgetMs,
  };
}

export function resolveTerminalPromptWriteTimeoutMs(
  text: string,
  opts?: Readonly<{
    baseTimeoutMs?: number | undefined;
    maxTimeoutMs?: number | undefined;
  }>,
): number {
  return resolveTerminalPromptWriteBudget(text, opts).timeoutMs;
}

export function resolveTerminalPromptProviderAcceptanceTimeoutMs(
  text: string,
  opts?: Readonly<{
    baseTimeoutMs?: number | undefined;
    maxTimeoutMs?: number | undefined;
    bytesWritten?: number | undefined;
  }>,
): number {
  const baseTimeoutMs = Math.max(0, Math.trunc(opts?.baseTimeoutMs ?? TERMINAL_INPUT_BASE_PROVIDER_ACCEPTANCE_TIMEOUT_MS));
  const maxTimeoutMs = Math.max(baseTimeoutMs, Math.trunc(opts?.maxTimeoutMs ?? TERMINAL_INPUT_MAX_PROVIDER_ACCEPTANCE_TIMEOUT_MS));
  const byteLength = Number.isFinite(opts?.bytesWritten)
    ? Math.max(0, Math.trunc(opts?.bytesWritten ?? 0))
    : Buffer.byteLength(text, 'utf8');
  const baseScaleThresholdMs = Math.max(baseTimeoutMs, TERMINAL_INPUT_BASE_PROVIDER_ACCEPTANCE_TIMEOUT_MS);
  const byteBudgetMs = Math.ceil(byteLength / PROVIDER_ACCEPTANCE_BYTES_PER_SECOND) * 1_000;
  const resolved = byteBudgetMs <= baseScaleThresholdMs
    ? baseTimeoutMs
    : Math.max(baseTimeoutMs, byteBudgetMs);
  return Math.min(maxTimeoutMs, resolved);
}
