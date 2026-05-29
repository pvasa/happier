import { describe, expect, it } from 'vitest';

import { ConnectedServiceAuthGenerationTracker } from './ConnectedServiceAuthGenerationTracker';

describe('ConnectedServiceAuthGenerationTracker', () => {
  it('abandons stale generation application when a newer generation starts', () => {
    const tracker = new ConnectedServiceAuthGenerationTracker();
    const key = { serviceId: 'openai-codex', groupId: 'main', targetId: 'session-1' };

    const first = tracker.beginApply({ ...key, generation: 1 });
    const second = tracker.beginApply({ ...key, generation: 2 });

    expect(tracker.completeApply(first)).toEqual({ status: 'stale', currentGeneration: 2 });
    expect(tracker.completeApply(second)).toEqual({ status: 'applied', currentGeneration: 2 });
    expect(tracker.getAppliedGeneration(key)).toBe(2);
  });

  it('rejects attempts to apply older generations', () => {
    const tracker = new ConnectedServiceAuthGenerationTracker();
    const key = { serviceId: 'openai-codex', groupId: 'main', targetId: 'session-1' };

    const current = tracker.beginApply({ ...key, generation: 3 });
    expect(tracker.completeApply(current)).toEqual({ status: 'applied', currentGeneration: 3 });

    const stale = tracker.beginApply({ ...key, generation: 2 });
    expect(stale.status).toBe('stale');
    expect(tracker.completeApply(stale)).toEqual({ status: 'stale', currentGeneration: 3 });
  });
});
