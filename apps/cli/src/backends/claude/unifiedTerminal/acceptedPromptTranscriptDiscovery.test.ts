import { describe, expect, it } from 'vitest';

import { STANDARD_CONTINUATION_RESUME_PROMPT } from '@/daemon/connectedServices/continuation/continuationResumePrompt';
import type { RawJSONLines } from '../types';
import { createClaudeUnifiedAcceptedPromptTranscriptDiscovery } from './acceptedPromptTranscriptDiscovery';

describe('createClaudeUnifiedAcceptedPromptTranscriptDiscovery', () => {
  it('consumes Claude queued-command enqueue rows as provider-accepted input', () => {
    const prompt = 'Please continue the QA from the current checkpoint.';
    const discovery = createClaudeUnifiedAcceptedPromptTranscriptDiscovery({
      acceptedPromptWindowMs: 5_000,
      nowMs: () => 10_000,
    });

    discovery.recordAcceptedPrompt({ message: prompt, acceptedAtMs: 10_000 });

    expect(discovery.consumeMatchingTranscript([{
      type: 'queue-operation',
      operation: 'enqueue',
      timestamp: new Date(10_250).toISOString(),
      content: prompt,
    } as unknown as RawJSONLines])).toBe(true);
  });

  it('keeps consumeMatchingTranscript receiver-independent', () => {
    const prompt = 'Please continue the QA from the current checkpoint.';
    const discovery = createClaudeUnifiedAcceptedPromptTranscriptDiscovery({
      acceptedPromptWindowMs: 5_000,
      nowMs: () => 10_000,
    });
    const { consumeMatchingTranscript } = discovery;

    discovery.recordAcceptedPrompt({ message: prompt, acceptedAtMs: 10_000 });

    expect(consumeMatchingTranscript([{
      type: 'queue-operation',
      operation: 'enqueue',
      timestamp: new Date(10_250).toISOString(),
      content: prompt,
    } as unknown as RawJSONLines])).toBe(true);
  });

  it('consumes Claude queued-command attachment rows as provider-accepted input', () => {
    const prompt = 'Please continue fully and completely.';
    const discovery = createClaudeUnifiedAcceptedPromptTranscriptDiscovery({
      acceptedPromptWindowMs: 5_000,
      nowMs: () => 10_000,
    });

    discovery.recordAcceptedPrompt({ message: prompt, acceptedAtMs: 10_000 });

    expect(discovery.consumeMatchingTranscript([{
      type: 'attachment',
      timestamp: new Date(10_250).toISOString(),
      attachment: {
        type: 'queued_command',
        prompt,
      },
    } as unknown as RawJSONLines])).toBe(true);
  });

  it('does not consume Claude queued-command removal rows as provider-accepted input', () => {
    const prompt = 'Please continue fully and completely.';
    const discovery = createClaudeUnifiedAcceptedPromptTranscriptDiscovery({
      acceptedPromptWindowMs: 5_000,
      nowMs: () => 10_000,
    });

    discovery.recordAcceptedPrompt({ message: prompt, acceptedAtMs: 10_000 });

    expect(discovery.consumeMatchingTranscript([{
      type: 'queue-operation',
      operation: 'remove',
      timestamp: new Date(10_250).toISOString(),
      content: prompt,
    } as unknown as RawJSONLines])).toBe(false);
  });

  it('does not consume meta continuation transcript rows as provider-accepted input', () => {
    const prompt = STANDARD_CONTINUATION_RESUME_PROMPT;
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

  it('consumes attachment-bearing typed user rows whose content is stored as text parts', () => {
    const prompt = [
      'Please review the attached screenshots.',
      '',
      'Focus on the pool detail layout.',
    ].join('\n');
    const discovery = createClaudeUnifiedAcceptedPromptTranscriptDiscovery({
      acceptedPromptWindowMs: 5_000,
      nowMs: () => 10_000,
    });

    discovery.recordAcceptedPrompt({ message: prompt, acceptedAtMs: 10_000 });

    expect(discovery.consumeMatchingTranscript([{
      type: 'user',
      uuid: 'provider-visible-attachment-prompt',
      timestamp: new Date(10_200).toISOString(),
      promptSource: 'typed',
      message: {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image', source: { type: 'file', path: '/tmp/screenshot.png' } },
        ],
      },
    } satisfies RawJSONLines])).toBe(true);
  });

  it('matches long multiline prompts with attachment text blocks after normalization', () => {
    const transcriptPrompt = [
      'ok great, now as you can see in the screenshots attached we have a few issues:',
      '- first, the hero CTAs on mobile need shorter labels.',
      '- then the mobile vertical parallax block is wrong.',
      '',
      'please analyse all of this based on the current state and rendering.',
      '',
      'also analyse deeper what could be causing mobile performance issue and lags on the page.',
      '',
      'Attachments: open and analyze these files before answering.',
      '[attachments]',
      '- .happier/uploads/messages/ea470cda/01711b9b-mobile_cta_target_design.png (mobile_cta_target_design.png, image/png, 342082 bytes)',
      '- .happier/uploads/messages/ea470cda/0b2c73c9-desktop_horizontal_scroll_wrong.png (desktop_horizontal_scroll_wrong.png, image/png, 366831 bytes)',
      '- .happier/uploads/messages/ea470cda/7c365255-mobile_parallax_block.png (mobile_parallax_block.png, image/png, 262290 bytes)',
      '[/attachments]',
    ].join('\n');
    const recordedPrompt = `  ${transcriptPrompt.replace(/\n/g, '\r\n')}  `;
    const discovery = createClaudeUnifiedAcceptedPromptTranscriptDiscovery({
      acceptedPromptWindowMs: 5_000,
      nowMs: () => 10_000,
    });

    discovery.recordAcceptedPrompt({ message: recordedPrompt, acceptedAtMs: 10_000 });

    expect(discovery.consumeMatchingTranscript([{
      type: 'user',
      uuid: 'provider-visible-long-attachment-prompt',
      promptId: 'prompt-visible-long-attachment-prompt',
      timestamp: new Date(10_200).toISOString(),
      promptSource: 'typed',
      message: {
        role: 'user',
        content: transcriptPrompt,
      },
    } satisfies RawJSONLines])).toBe(true);
  });

  it('returns structured transcript evidence and binds identical text in FIFO order', () => {
    const prompt = 'repeat this exact prompt';
    const discovery = createClaudeUnifiedAcceptedPromptTranscriptDiscovery({
      acceptedPromptWindowMs: 5_000,
      nowMs: () => 10_000,
    });

    discovery.recordAcceptedPrompt({
      message: prompt,
      acceptedAtMs: 10_000,
      deliveryIdentity: { localIds: ['first-local'], userMessageSeq: 11 },
    });
    discovery.recordAcceptedPrompt({
      message: prompt,
      acceptedAtMs: 10_010,
      deliveryIdentity: { localIds: ['second-local'], userMessageSeq: 12 },
    });

    const first = discovery.claimMatchingTranscript([{
      type: 'user',
      uuid: 'provider-user-first',
      promptId: 'provider-prompt-first',
      timestamp: new Date(10_100).toISOString(),
      message: { role: 'user', content: prompt },
    } satisfies RawJSONLines]);
    const second = discovery.claimMatchingTranscript([{
      type: 'user',
      uuid: 'provider-user-second',
      promptId: 'provider-prompt-second',
      timestamp: new Date(10_200).toISOString(),
      message: { role: 'user', content: prompt },
    } satisfies RawJSONLines]);

    expect(first).toEqual(expect.objectContaining({
      transcriptUuid: 'provider-user-first',
      transcriptPromptId: 'provider-prompt-first',
      deliveryIdentity: { localIds: ['first-local'], userMessageSeq: 11 },
    }));
    expect(second).toEqual(expect.objectContaining({
      transcriptUuid: 'provider-user-second',
      transcriptPromptId: 'provider-prompt-second',
      deliveryIdentity: { localIds: ['second-local'], userMessageSeq: 12 },
    }));
  });

  it('does not consume a matching accepted prompt until the caller commits the match', () => {
    const prompt = 'confirm me after the arbiter accepts';
    const discovery = createClaudeUnifiedAcceptedPromptTranscriptDiscovery({
      acceptedPromptWindowMs: 5_000,
      nowMs: () => 10_000,
    });
    discovery.recordAcceptedPrompt({
      message: prompt,
      acceptedAtMs: 10_000,
      deliveryIdentity: { localIds: ['local-1'], userMessageSeq: 21 },
    });

    const messages = [{
      type: 'user',
      uuid: 'provider-user-commit-later',
      promptId: 'provider-prompt-commit-later',
      timestamp: new Date(10_100).toISOString(),
      message: { role: 'user', content: prompt },
    } satisfies RawJSONLines];
    const match = discovery.findMatchingTranscript(messages);

    expect(match).toEqual(expect.objectContaining({
      acceptedPromptId: 'accepted-prompt-1',
      transcriptUuid: 'provider-user-commit-later',
    }));
    expect(discovery.findMatchingTranscript(messages)).toEqual(expect.objectContaining({
      acceptedPromptId: 'accepted-prompt-1',
    }));
    expect(discovery.consumeAcceptedPromptMatch(match!)).toBe(true);
    expect(discovery.findMatchingTranscript(messages)).toBeNull();
  });

  it('does not let duplicate transcript ingress consume a second identical accepted prompt', () => {
    const prompt = 'same text seen through duplicate watchers';
    const transcriptRow = {
      type: 'user',
      uuid: 'provider-user-duplicate-ingress',
      promptId: 'provider-prompt-duplicate-ingress',
      timestamp: new Date(10_100).toISOString(),
      message: { role: 'user', content: prompt },
    } satisfies RawJSONLines;
    const discovery = createClaudeUnifiedAcceptedPromptTranscriptDiscovery({
      acceptedPromptWindowMs: 5_000,
      nowMs: () => 10_000,
    });
    discovery.recordAcceptedPrompt({
      message: prompt,
      acceptedAtMs: 10_000,
      deliveryIdentity: { localIds: ['first-local'], userMessageSeq: 31 },
    });
    discovery.recordAcceptedPrompt({
      message: prompt,
      acceptedAtMs: 10_010,
      deliveryIdentity: { localIds: ['second-local'], userMessageSeq: 32 },
    });

    const first = discovery.claimMatchingTranscript([transcriptRow]);
    const duplicate = discovery.claimMatchingTranscript([transcriptRow]);

    expect(first).toEqual(expect.objectContaining({
      deliveryIdentity: { localIds: ['first-local'], userMessageSeq: 31 },
    }));
    expect(duplicate).toBeNull();
  });

  it('retires a provider-accepted identity so a later identical prompt can still match transcript confirmation', () => {
    const prompt = 'same text with different delivery identities';
    const discovery = createClaudeUnifiedAcceptedPromptTranscriptDiscovery({
      acceptedPromptWindowMs: 5_000,
      nowMs: () => 10_000,
    });
    discovery.recordAcceptedPrompt({
      message: prompt,
      acceptedAtMs: 10_000,
      deliveryIdentity: { localIds: ['first-local'], userMessageSeq: 41 },
    });
    discovery.recordAcceptedPrompt({
      message: prompt,
      acceptedAtMs: 10_010,
      deliveryIdentity: { localIds: ['second-local'], userMessageSeq: 42 },
    });

    expect(discovery.consumeAcceptedPromptByBatch({
      message: prompt,
      maxUserMessageSeq: 41,
      userMessageLocalIds: ['first-local'],
    })).toBe(true);

    expect(discovery.claimMatchingTranscript([{
      type: 'user',
      uuid: 'provider-user-after-hook-acceptance',
      promptId: 'provider-prompt-after-hook-acceptance',
      timestamp: new Date(10_100).toISOString(),
      message: { role: 'user', content: prompt },
    } satisfies RawJSONLines])).toEqual(expect.objectContaining({
      deliveryIdentity: { localIds: ['second-local'], userMessageSeq: 42 },
    }));
  });

  it('does not consume command-name-only slash evidence when multiple accepted prompts share the command', () => {
    const discovery = createClaudeUnifiedAcceptedPromptTranscriptDiscovery({
      acceptedPromptWindowMs: 5_000,
      nowMs: () => 10_000,
    });

    discovery.recordAcceptedPrompt({ message: '/model opus', acceptedAtMs: 10_000 });
    discovery.recordAcceptedPrompt({ message: '/model sonnet', acceptedAtMs: 10_010 });

    expect(discovery.consumeMatchingTranscript([{
      type: 'user',
      uuid: 'command-name-only',
      timestamp: new Date(10_250).toISOString(),
      message: {
        role: 'user',
        content: '<command-name>/model</command-name>\n<command-message>model</command-message>',
      },
    } satisfies RawJSONLines])).toBe(false);

    expect(discovery.consumeMatchingTranscript([{
      type: 'queue-operation',
      operation: 'enqueue',
      timestamp: new Date(10_300).toISOString(),
      content: '/model opus',
    } as unknown as RawJSONLines])).toBe(true);
    expect(discovery.consumeMatchingTranscript([{
      type: 'queue-operation',
      operation: 'enqueue',
      timestamp: new Date(10_320).toISOString(),
      content: '/model sonnet',
    } as unknown as RawJSONLines])).toBe(true);
  });
});
