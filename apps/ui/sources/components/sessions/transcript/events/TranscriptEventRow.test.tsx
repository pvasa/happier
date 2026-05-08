import { ActivityIndicator } from 'react-native';
import { describe, expect, it } from 'vitest';

import { renderScreen } from '@/dev/testkit';

import { TranscriptEventRow } from './TranscriptEventRow';

describe('TranscriptEventRow', () => {
    it('derives started context compaction loading from the phase', async () => {
        const screen = await renderScreen(
            <TranscriptEventRow
                event={{
                    type: 'context-compaction',
                    phase: 'started',
                    lifecycleId: 'compact_1',
                    provider: 'codex',
                }}
            />,
        );

        expect(screen.findByType(ActivityIndicator)).toBeTruthy();
        expect(screen.findByProps({ testID: 'transcript-event-context-compaction-started' })).toBeTruthy();
    });

    it('renders completed context compaction events as a persisted event row', async () => {
        const screen = await renderScreen(
            <TranscriptEventRow
                event={{
                    type: 'context-compaction',
                    phase: 'completed',
                    lifecycleId: 'compact_1',
                    provider: 'codex',
                }}
            />,
        );

        expect(() => screen.findByType(ActivityIndicator)).toThrow();
        expect(screen.findByProps({ testID: 'transcript-event-context-compaction-completed' })).toBeTruthy();
    });

    it('renders cancelled context compaction events without loading state', async () => {
        const screen = await renderScreen(
            <TranscriptEventRow
                event={{
                    type: 'context-compaction',
                    phase: 'cancelled',
                    lifecycleId: 'compact_1',
                    provider: 'pi',
                    source: 'provider-event',
                }}
            />,
        );

        expect(() => screen.findByType(ActivityIndicator)).toThrow();
        expect(screen.findByProps({ testID: 'transcript-event-context-compaction-cancelled' })).toBeTruthy();
    });
});
