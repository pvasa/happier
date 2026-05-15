import * as React from 'react';

import type { MockComposerKeyboardScaffoldHarness } from '../harness/composerKeyboardScaffoldHarness';

export type {
    MockComposerKeyboardScaffoldHarness,
    MockComposerKeyboardScaffoldRender,
} from '../harness/composerKeyboardScaffoldHarness';

export type TestSharedValue<TValue> = {
    value: TValue;
    get: () => TValue;
    set: (value: TValue | ((value: TValue) => TValue)) => void;
    addListener: (listenerID: number, listener: (value: TValue) => void) => void;
    removeListener: (listenerID: number) => void;
    modify: (modifier?: (value: TValue) => TValue, forceUpdate?: boolean) => void;
};

const availablePanelHeightSubscribersByValue = new WeakMap<TestSharedValue<number>, Set<(height: number) => void>>();

export type ComposerKeyboardLayout = Readonly<{
    availablePanelHeight: TestSharedValue<number>;
    bottomInset: TestSharedValue<number>;
    composerHeight: TestSharedValue<number>;
    isKeyboardLiftSuppressed: TestSharedValue<boolean>;
    keyboardHeightForInset: TestSharedValue<number>;
    keyboardHeightLive: TestSharedValue<number>;
    keyboardProgress: TestSharedValue<number>;
    listBottomInset: TestSharedValue<number>;
    retainKeyboardLift: () => () => void;
    setComposerMeasuredHeight: (height: number) => void;
    subscribeAvailablePanelHeight: (listener: (height: number) => void) => () => void;
}>;

export type MockComposerKeyboardLayoutOverrides = Partial<Readonly<{
    availablePanelHeight: number;
    bottomInset: number;
    composerHeight: number;
    isKeyboardLiftSuppressed: boolean;
    keyboardHeightForInset: number;
    keyboardHeightLive: number;
    keyboardProgress: number;
    listBottomInset: number;
}>>;

export type MockComposerKeyboardScaffoldMode = 'session' | 'newSession';

export type MockComposerKeyboardScaffoldProps = Readonly<{
    accessibilityLabel?: string;
    accessibilityRole?: string;
    children?: React.ReactNode;
    composer: React.ReactNode;
    composerTestID?: string;
    contentProps?: Record<string, unknown>;
    contentStyle?: unknown;
    contentTestID?: string;
    harness?: MockComposerKeyboardScaffoldHarness;
    layoutBottomInset?: number;
    layout?: ComposerKeyboardLayout;
    mode: MockComposerKeyboardScaffoldMode;
    safeAreaBottom?: number;
    style?: unknown;
    testID?: string;
}>;

function createTestSharedValue<TValue>(value: TValue): TestSharedValue<TValue> {
    const listeners = new Map<number, (value: TValue) => void>();
    const sharedValue: TestSharedValue<TValue> = {
        value,
        get: () => sharedValue.value,
        set: (nextValue) => {
            sharedValue.value = typeof nextValue === 'function'
                ? (nextValue as (value: TValue) => TValue)(sharedValue.value)
                : nextValue;
            for (const listener of listeners.values()) {
                listener(sharedValue.value);
            }
        },
        addListener: (listenerID, listener) => {
            listeners.set(listenerID, listener);
        },
        removeListener: (listenerID) => {
            listeners.delete(listenerID);
        },
        modify: (modifier) => {
            if (!modifier) return;
            sharedValue.set(modifier(sharedValue.value));
        },
    };
    return sharedValue;
}

export function createMockComposerKeyboardLayout(
    overrides: MockComposerKeyboardLayoutOverrides = {},
): ComposerKeyboardLayout {
    const composerHeight = createTestSharedValue(overrides.composerHeight ?? 0);
    const availablePanelHeight = createTestSharedValue(overrides.availablePanelHeight ?? 0);
    const availablePanelHeightSubscribers = new Set<(height: number) => void>();
    availablePanelHeightSubscribersByValue.set(availablePanelHeight, availablePanelHeightSubscribers);

    return {
        availablePanelHeight,
        bottomInset: createTestSharedValue(overrides.bottomInset ?? 0),
        composerHeight,
        isKeyboardLiftSuppressed: createTestSharedValue(overrides.isKeyboardLiftSuppressed ?? false),
        keyboardHeightForInset: createTestSharedValue(overrides.keyboardHeightForInset ?? 0),
        keyboardHeightLive: createTestSharedValue(overrides.keyboardHeightLive ?? 0),
        keyboardProgress: createTestSharedValue(overrides.keyboardProgress ?? 0),
        listBottomInset: createTestSharedValue(overrides.listBottomInset ?? 0),
        retainKeyboardLift: () => () => {},
        setComposerMeasuredHeight: (height) => {
            composerHeight.value = height;
        },
        subscribeAvailablePanelHeight: (listener) => {
            availablePanelHeightSubscribers.add(listener);
            listener(availablePanelHeight.value);
            return () => {
                availablePanelHeightSubscribers.delete(listener);
            };
        },
    };
}

export function setMockComposerKeyboardLiveHeight(layout: ComposerKeyboardLayout, height: number): void {
    layout.keyboardHeightLive.value = height;
}

export function setMockComposerKeyboardSettledHeight(layout: ComposerKeyboardLayout, height: number): void {
    layout.keyboardHeightForInset.value = height;
}

export function setMockComposerHeight(layout: ComposerKeyboardLayout, height: number): void {
    layout.setComposerMeasuredHeight(height);
}

export function setMockComposerAvailablePanelHeight(layout: ComposerKeyboardLayout, height: number): void {
    layout.availablePanelHeight.value = height;
    const subscribers = availablePanelHeightSubscribersByValue.get(layout.availablePanelHeight);
    for (const listener of subscribers ?? []) {
        listener(height);
    }
}

export function setMockComposerKeyboardSuppressed(layout: ComposerKeyboardLayout, isSuppressed: boolean): void {
    layout.isKeyboardLiftSuppressed.value = isSuppressed;
}

export function mockUseComposerKeyboardLayout(
    layoutOverrides?: MockComposerKeyboardLayoutOverrides,
): () => ComposerKeyboardLayout {
    const layout = createMockComposerKeyboardLayout(layoutOverrides);
    return () => layout;
}

export function MockComposerKeyboardScaffold(props: MockComposerKeyboardScaffoldProps): React.ReactElement {
    const {
        children,
        composer,
        contentProps,
        composerTestID,
        contentTestID,
        harness,
        layout = createMockComposerKeyboardLayout(),
        testID,
        ...rootProps
    } = props;
    harness?.recordRender({ layout, props });

    return React.createElement(
        'MockComposerKeyboardScaffold',
        { ...rootProps, testID },
        React.createElement('MockComposerKeyboardScaffoldContent', { ...contentProps, testID: contentTestID }, children),
        React.createElement('MockComposerKeyboardScaffoldComposer', { testID: composerTestID }, composer),
    );
}
