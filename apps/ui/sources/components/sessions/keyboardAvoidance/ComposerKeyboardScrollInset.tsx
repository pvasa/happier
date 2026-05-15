import * as React from 'react';
import { type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';

import { useComposerKeyboardLayout } from './ComposerKeyboardContext';

export function ComposerKeyboardScrollInset(props: Readonly<{
    style?: StyleProp<ViewStyle>;
    testID?: string;
}>): React.ReactElement | null {
    const layout = useComposerKeyboardLayout();
    const animatedStyle = useAnimatedStyle(() => ({
        height: layout?.listBottomInset.value ?? 0,
    }), [layout]);

    if (!layout) {
        return null;
    }

    return (
        <Animated.View
            pointerEvents="none"
            testID={props.testID}
            style={[props.style, animatedStyle]}
        />
    );
}
