import { describe, expect, it } from 'vitest';

import { doesClaudeUnifiedPromptBatchMatchAcceptedTranscript } from './acceptedPromptDeliveryIdentity';

describe('doesClaudeUnifiedPromptBatchMatchAcceptedTranscript', () => {
  it('does not treat an empty accepted-prompt delivery identity as a wildcard', () => {
    expect(doesClaudeUnifiedPromptBatchMatchAcceptedTranscript({
      batch: {
        message: 'queued prompt at the arbiter head',
        maxUserMessageSeq: 42,
        userMessageLocalIds: ['queued-42'],
      },
      match: {
        deliveryIdentity: null,
        acceptedPromptNormalizedText: 'older unattributed prompt',
      },
    })).toBe(false);
  });

  it('falls back to canonical prompt text when no seq or local id can identify the accepted prompt', () => {
    expect(doesClaudeUnifiedPromptBatchMatchAcceptedTranscript({
      batch: {
        message: '  first prompt\r\nwith trailing spaces   ',
        maxUserMessageSeq: null,
        userMessageLocalIds: [],
      },
      match: {
        deliveryIdentity: null,
        acceptedPromptNormalizedText: 'first prompt\nwith trailing spaces',
      },
    })).toBe(true);
  });

  it('prefers delivery identity over prompt text when seq or local ids are available', () => {
    expect(doesClaudeUnifiedPromptBatchMatchAcceptedTranscript({
      batch: {
        message: 'same rendered text',
        maxUserMessageSeq: 51,
        userMessageLocalIds: ['local-51'],
      },
      match: {
        deliveryIdentity: { localIds: ['local-52'], userMessageSeq: 52 },
        acceptedPromptNormalizedText: 'same rendered text',
      },
    })).toBe(false);
  });
});
