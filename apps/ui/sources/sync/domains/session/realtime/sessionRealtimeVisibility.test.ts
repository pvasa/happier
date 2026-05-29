import { describe, expect, it } from 'vitest';

import { sessionNeedsLiveTranscript } from './sessionRealtimeVisibility';

describe('sessionNeedsLiveTranscript', () => {
    it('returns visible and voice reasons as full transcript consumers', () => {
        expect(sessionNeedsLiveTranscript({
            sessionId: 's1',
            isVisible: true,
        })).toEqual({ active: true, reasons: ['visible'] });

        expect(sessionNeedsLiveTranscript({
            sessionId: 's1',
            voicePrimaryActionSessionId: 's1',
            voiceTrackedSessionIds: ['s2'],
        })).toEqual({ active: true, reasons: ['voicePrimaryAction'] });

        expect(sessionNeedsLiveTranscript({
            sessionId: 's1',
            voiceTrackedSessionIds: ['s1'],
        })).toEqual({ active: true, reasons: ['voiceTracked'] });
    });

    it('does not treat unrelated same-root sessions as SCM consumers without an explicit same-project scope', () => {
        const decision = sessionNeedsLiveTranscript({
            sessionId: 's1',
            sessionScmScope: {
                sessionId: 's1',
                canonicalProjectKey: 'machine:/repo/packages/a',
                machineScopeId: 'machine',
                repoRoot: '/repo',
            },
            scmMountedScopes: [
                {
                    sessionId: 's2',
                    canonicalProjectKey: 'machine:/repo/packages/b',
                    machineScopeId: 'machine',
                    repoRoot: '/repo',
                    needsMutationTranscript: true,
                },
            ],
        });

        expect(decision).toEqual({ active: false, reasons: [] });
    });

    it('activates for exact SCM session scopes and explicit canonical project scopes', () => {
        expect(sessionNeedsLiveTranscript({
            sessionId: 's1',
            sessionScmScope: {
                sessionId: 's1',
                canonicalProjectKey: 'machine:/repo',
            },
            scmMountedScopes: [
                {
                    sessionId: 's2',
                    canonicalProjectKey: 'machine:/repo',
                    needsMutationTranscript: true,
                },
            ],
        })).toEqual({ active: true, reasons: ['scmSameProjectScope'] });

        expect(sessionNeedsLiveTranscript({
            sessionId: 's1',
            scmMountedScopes: [
                {
                    sessionId: 's1',
                    needsMutationTranscript: true,
                },
            ],
        })).toEqual({ active: true, reasons: ['scmSameSession'] });
    });
});
