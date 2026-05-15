import * as React from 'react';
import { type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';

import { useComposerKeyboardLayout } from './ComposerKeyboardContext';

export function ComposerKeyboardFloatingInset(props: Readonly<{
    baseBottom?: number;
    children: React.ReactNode;
    style?: StyleProp<ViewStyle>;
    testID?: string;
}>): React.ReactElement {
    const layout = useComposerKeyboardLayout();
    const baseBottom = props.baseBottom ?? 0;
    const animatedStyle = useAnimatedStyle(() => ({
        bottom: baseBottom + (layout?.listBottomInset.value ?? 0),
    }), [baseBottom, layout]);

    return (
        <Animated.View
            testID={props.testID}
            style={[props.style, animatedStyle]}
        >
            {props.children}
        </Animated.View>
    );
}
