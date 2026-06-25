import { describe, expect, it } from 'vitest';

import { shouldUseInFlightSteer } from './shouldUseInFlightSteer';

describe('shouldUseInFlightSteer', () => {
    it('allows steering when the runtime supports it and the active turn is steerable', () => {
        expect(shouldUseInFlightSteer({
            runtime: {
                supportsInFlightSteer: () => true,
                isTurnInFlight: () => true,
                canSteerPrompt: () => true,
            },
            didChangePermissionMode: false,
            isPromptNonSteerable: false,
        })).toBe(true);
    });

    it('blocks steering when the runtime marks the active turn as non-steerable', () => {
        expect(shouldUseInFlightSteer({
            runtime: {
                supportsInFlightSteer: () => true,
                isTurnInFlight: () => true,
                canSteerPrompt: () => false,
            },
            didChangePermissionMode: false,
            isPromptNonSteerable: false,
        })).toBe(false);
    });

    it('falls back to in-flight state for runtimes without active-turn steerability', () => {
        expect(shouldUseInFlightSteer({
            runtime: {
                supportsInFlightSteer: () => true,
                isTurnInFlight: () => true,
            },
            didChangePermissionMode: false,
            isPromptNonSteerable: false,
        })).toBe(true);
    });

    it('blocks steering when the permission mode changed', () => {
        expect(shouldUseInFlightSteer({
            runtime: {
                supportsInFlightSteer: () => true,
                isTurnInFlight: () => true,
                canSteerPrompt: () => true,
            },
            didChangePermissionMode: true,
            isPromptNonSteerable: false,
        })).toBe(false);
    });

    it('blocks only prompts classified as non-steerable by the shared payload policy', () => {
        expect(shouldUseInFlightSteer({
            runtime: {
                supportsInFlightSteer: () => true,
                isTurnInFlight: () => true,
                canSteerPrompt: () => true,
            },
            didChangePermissionMode: false,
            isPromptNonSteerable: true,
        })).toBe(false);
    });
});
