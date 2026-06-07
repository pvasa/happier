import { describe, expect, it } from 'vitest';

import {
  buildClaudeJsonlLocalId,
  extractClaudeJsonlMessageKeyFromLocalId,
  extractClaudeJsonlMessageKeyFromSessionContent,
} from './claudeJsonlMessageKey';
import type { RawJSONLines } from '../types';

describe('claudeJsonlMessageKey', () => {
  it('builds deterministic local ids from Claude JSONL ids and sidechain ids', () => {
    expect(buildClaudeJsonlLocalId({
      type: 'assistant',
      uuid: 'assistant-1',
      sidechainId: 'toolu_1',
      message: { role: 'assistant', content: [] },
    } as RawJSONLines)).toBe('claude-jsonl:toolu_1:assistant:assistant-1');
  });

  it('extracts committed keys from deterministic local ids and stored raw output content', () => {
    expect(extractClaudeJsonlMessageKeyFromLocalId('claude-jsonl:main:assistant:from-local-id'))
      .toBe('main:assistant:from-local-id');

    expect(extractClaudeJsonlMessageKeyFromSessionContent({
      role: 'agent',
      content: {
        type: 'output',
        data: {
          type: 'assistant',
          uuid: 'from-content',
          sidechainId: 'toolu_sidechain',
          message: { role: 'assistant', content: [] },
        },
      },
    })).toBe('toolu_sidechain:assistant:from-content');

    expect(extractClaudeJsonlMessageKeyFromSessionContent({
      role: 'user',
      content: { type: 'text', text: 'prompt without raw Claude uuid' },
    })).toBeNull();
  });
});
