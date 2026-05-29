import { describe, expect, it } from 'vitest';

import { buildClaudeEffortCliArgs } from './claudeEffort';

describe('buildClaudeEffortCliArgs', () => {
  it('treats Opus 4.8 high as the default effort', () => {
    expect(buildClaudeEffortCliArgs({ modelId: 'claude-opus-4-8', effort: 'high' })).toEqual([]);
    expect(buildClaudeEffortCliArgs({ modelId: 'claude-opus-4-8', effort: 'xhigh' })).toEqual(['--effort', 'xhigh']);
  });

  it('treats the generic opus alias as Opus 4.8 for default effort resolution', () => {
    expect(buildClaudeEffortCliArgs({ modelId: 'opus', effort: 'high' })).toEqual([]);
    expect(buildClaudeEffortCliArgs({ modelId: 'opus', effort: 'xhigh' })).toEqual(['--effort', 'xhigh']);
  });

  it('keeps Opus 4.7 behavior where high still requires an explicit override', () => {
    expect(buildClaudeEffortCliArgs({ modelId: 'claude-opus-4-7', effort: 'high' })).toEqual(['--effort', 'high']);
  });
});
