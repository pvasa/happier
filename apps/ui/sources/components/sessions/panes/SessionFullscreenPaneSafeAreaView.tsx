import * as React from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet } from 'react-native-unistyles';

type SessionFullscreenPaneSafeAreaViewProps = Readonly<{
    testID: string;
    children: React.ReactNode;
}>;

const stylesheet = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        minHeight: 0,
        minWidth: 0,
        backgroundColor: theme.colors.surface,
    },
}));

export const SessionFullscreenPaneSafeAreaView = React.memo(function SessionFullscreenPaneSafeAreaView(
    props: SessionFullscreenPaneSafeAreaViewProps,
) {
    const safeArea = useSafeAreaInsets();

    return (
        <View
            testID={props.testID}
            style={[
                stylesheet.container,
                {
                    paddingTop: safeArea.top,
                    paddingBottom: safeArea.bottom,
                },
            ]}
        >
            {props.children}
        </View>
    );
});
