import { describe, expect, it } from 'vitest';

import type { RawJSONLines } from '../types';
import { createClaudeUnifiedAcceptedPromptTranscriptDiscovery } from './acceptedPromptTranscriptDiscovery';

describe('createClaudeUnifiedAcceptedPromptTranscriptDiscovery', () => {
  it('does not consume meta continuation transcript rows as provider-accepted input', () => {
    const prompt = 'The interrupted turn was recovered. Continue from where you left off.';
    const discovery = createClaudeUnifiedAcceptedPromptTranscriptDiscovery({
      acceptedPromptWindowMs: 5_000,
      nowMs: () => 10_000,
    });

    discovery.recordAcceptedPrompt({ message: prompt, acceptedAtMs: 10_000 });

    expect(discovery.consumeMatchingTranscript([{
      type: 'user',
      uuid: 'meta-continuation-prompt',
      isMeta: true,
      timestamp: new Date(10_100).toISOString(),
      message: {
        role: 'user',
        content: prompt,
      },
    } satisfies RawJSONLines])).toBe(false);

    expect(discovery.consumeMatchingTranscript([{
      type: 'user',
      uuid: 'provider-visible-prompt',
      timestamp: new Date(10_200).toISOString(),
      message: {
        role: 'user',
        content: prompt,
      },
    } satisfies RawJSONLines])).toBe(true);
  });
});
