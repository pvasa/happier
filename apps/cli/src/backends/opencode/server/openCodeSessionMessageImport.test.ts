import { describe, expect, it } from 'vitest';

import { extractOpenCodeTextHistoryItems } from './openCodeSessionMessageImport';

describe('extractOpenCodeTextHistoryItems', () => {
  it('includes inline assistant text from non-reasoning parts', () => {
    expect(extractOpenCodeTextHistoryItems([
      {
        info: { id: 'msg_assistant_1', role: 'assistant', time: { created: 2 } },
        parts: [
          { type: 'reasoning', text: 'should stay hidden' },
          { type: 'step', text: 'VISIBLE_INLINE_TEXT' },
        ],
      },
    ])).toEqual([
      {
        messageId: 'msg_assistant_1',
        role: 'assistant',
        createdAtMs: 2,
        text: 'VISIBLE_INLINE_TEXT',
      },
    ]);
  });

  it('ignores incidental text on non-renderable parts', () => {
    expect(extractOpenCodeTextHistoryItems([
      {
        info: { id: 'msg_assistant_2', role: 'assistant', time: { created: 3 } },
        parts: [
          { type: 'tool', text: 'TOOL_STATUS_SHOULD_NOT_IMPORT' },
          { type: 'step', text: 'VISIBLE_STEP_TEXT' },
          { type: 'status', text: 'STATUS_SHOULD_NOT_IMPORT' },
        ],
      },
    ])).toEqual([
      {
        messageId: 'msg_assistant_2',
        role: 'assistant',
        createdAtMs: 3,
        text: 'VISIBLE_STEP_TEXT',
      },
    ]);
  });
});
