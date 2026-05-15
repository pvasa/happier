import * as React from 'react';

export type ReanimatedSharedValue<T> = { value: T };

export function createReanimatedModuleMock() {
    const Animated = {
        View: 'Animated.View',
        ScrollView: 'Animated.ScrollView',
        Text: 'Animated.Text',
        createAnimatedComponent: (component: unknown) => component,
    } as const;

    const useSharedValue = <T,>(initial: T): ReanimatedSharedValue<T> => {
        const ref = React.useRef<ReanimatedSharedValue<T> | null>(null);
        if (!ref.current) {
            ref.current = { value: initial };
        }
        return ref.current;
    };
    const useDerivedValue = <T,>(factory: () => T): ReanimatedSharedValue<T> => {
        const ref = React.useRef<ReanimatedSharedValue<T> | null>(null);
        const value = factory();
        if (!ref.current) {
            ref.current = { value };
        } else {
            ref.current.value = value;
        }
        return ref.current;
    };
    const runOnJS = <TArgs extends unknown[], TResult>(fn: (...args: TArgs) => TResult) => fn;
    const runOnUI = <TArgs extends unknown[], TResult>(fn: (...args: TArgs) => TResult) => fn;

    return {
        __esModule: true,
        default: Animated,
        ...Animated,
        cancelAnimation: () => {},
        runOnJS,
        runOnUI,
        useAnimatedProps: <T,>(factory: () => T): T => factory(),
        useAnimatedReaction: (prepare: () => unknown, react: (value: unknown, previous: unknown) => void) => {
            try {
                react(prepare(), undefined);
            } catch {
                // Native Reanimated swallows worklet-environment details that are unavailable in node tests.
            }
        },
        useAnimatedStyle: <T,>(factory: () => T): T => factory(),
        useDerivedValue,
        useSharedValue,
        withRepeat: <T,>(value: T): T => value,
        withSpring: <T,>(value: T): T => value,
        withTiming: <T,>(value: T): T => value,
    };
}
