import { describe, expect, it } from 'vitest';

import { buildHermesChatArgs } from '@/backends/hermes/localControl/hermesChatInvocation';

describe('buildHermesChatArgs', () => {
  it('resumes an existing session by id', () => {
    expect(buildHermesChatArgs({ resumeSessionId: 'S1' })).toEqual(['chat', '--resume', 'S1']);
  });

  it('starts a fresh chat when there is no resume id', () => {
    expect(buildHermesChatArgs({ resumeSessionId: null })).toEqual(['chat']);
  });

  it('appends extra args after the base invocation', () => {
    expect(buildHermesChatArgs({ resumeSessionId: 'S1', extraArgs: ['--yolo'] })).toEqual([
      'chat',
      '--resume',
      'S1',
      '--yolo',
    ]);
  });
});
