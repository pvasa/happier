import type { ConnectedServiceQuotaFetcher } from './types';

import { createClaudeSubscriptionQuotaFetcher } from './fetchers/claudeSubscriptionQuotaFetcher';
import { createGeminiQuotaFetcher } from './fetchers/geminiQuotaFetcher';
import { createOpenAiCodexQuotaFetcher } from './fetchers/openAiCodexQuotaFetcher';

function parsePositiveIntEnv(raw: string | undefined, fallback: number, bounds: Readonly<{ min: number; max: number }>): number {
  const value = (raw ?? '').trim();
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(bounds.max, Math.max(bounds.min, Math.trunc(parsed)));
}

function parseNonEmptyStringEnv(raw: string | undefined): string | undefined {
  const trimmed = (raw ?? '').trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Returns true when a kill-switch env var is set to a truthy value ("1", "true", "yes").
 *
 * HAPPIER_CONNECTED_SERVICES_DISABLE_CODEX_QUOTA_ENDPOINT=1
 *   When set, the private Codex quota endpoint (chatgpt.com/backend-api/wham/usage) is
 *   skipped; the fetcher returns a quota_unknown snapshot instead. This allows the
 *   endpoint to be disabled in the field without a release.
 *
 * The per-call usageUrl override (HAPPIER_CONNECTED_SERVICES_OPENAI_CODEX_USAGE_URL)
 * takes precedence — it is the documented escape hatch for routing to a different URL.
 */
function parseDisableQuotaEndpointEnv(raw: string | undefined): boolean {
  const value = (raw ?? '').trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes';
}

export function createConnectedServiceQuotaFetchers(env: NodeJS.ProcessEnv): Array<ConnectedServiceQuotaFetcher> {
  const staleAfterMs = parsePositiveIntEnv(env.HAPPIER_CONNECTED_SERVICES_QUOTAS_STALE_AFTER_MS, 30 * 60_000, {
    min: 5_000,
    max: 24 * 60 * 60_000,
  });

  const disableCodexQuotaEndpoint = parseDisableQuotaEndpointEnv(
    env.HAPPIER_CONNECTED_SERVICES_DISABLE_CODEX_QUOTA_ENDPOINT,
  );
  const disableClaudeSubscriptionQuotaEndpoint = parseDisableQuotaEndpointEnv(
    env.HAPPIER_CONNECTED_SERVICES_DISABLE_CLAUDE_SUBSCRIPTION_QUOTA_ENDPOINT,
  );

  // The per-call usageUrl override takes precedence over the kill-switch: if a custom
  // URL is configured, the kill-switch is ignored and the custom URL is used as-is.
  const codexUsageUrl = parseNonEmptyStringEnv(env.HAPPIER_CONNECTED_SERVICES_OPENAI_CODEX_USAGE_URL);
  const codexResetCreditsUrl = parseNonEmptyStringEnv(env.HAPPIER_CONNECTED_SERVICES_OPENAI_CODEX_RESET_CREDITS_URL);

  return [
    createOpenAiCodexQuotaFetcher({
      usageUrl: codexUsageUrl,
      resetCreditsUrl: codexResetCreditsUrl,
      staleAfterMs,
      userAgent: parseNonEmptyStringEnv(env.HAPPIER_CONNECTED_SERVICES_QUOTAS_USER_AGENT),
      disablePrivateEndpoint: disableCodexQuotaEndpoint,
    }),
    createClaudeSubscriptionQuotaFetcher({
      usageUrl: parseNonEmptyStringEnv(env.HAPPIER_CONNECTED_SERVICES_CLAUDE_SUBSCRIPTION_USAGE_URL ?? env.HAPPIER_CONNECTED_SERVICES_ANTHROPIC_USAGE_URL),
      staleAfterMs,
      userAgent: parseNonEmptyStringEnv(env.HAPPIER_CONNECTED_SERVICES_CLAUDE_SUBSCRIPTION_USER_AGENT),
      disablePrivateEndpoint: disableClaudeSubscriptionQuotaEndpoint,
    }),
    createGeminiQuotaFetcher(),
  ];
}
