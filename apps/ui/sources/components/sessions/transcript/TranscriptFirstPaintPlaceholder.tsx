import * as React from 'react';
import { View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { ActivitySpinner } from '@/components/ui/feedback/ActivitySpinner';

const PLACEHOLDER_TOP_PADDING_PX = 18;
const PLACEHOLDER_HORIZONTAL_PADDING_PX = 16;
const PLACEHOLDER_ROW_GAP_PX = 14;
const PLACEHOLDER_BUBBLE_RADIUS_PX = 8;
const PLACEHOLDER_BUBBLE_PADDING_PX = 12;
const PLACEHOLDER_BUBBLE_LINE_GAP_PX = 8;
const PLACEHOLDER_LINE_HEIGHT_PX = 10;
const PLACEHOLDER_LINE_RADIUS_PX = 5;
const PLACEHOLDER_SPINNER_TOP_PX = 22;

const PLACEHOLDER_ROWS: ReadonlyArray<Readonly<{
    align: 'left' | 'right';
    lineWidths: readonly `${number}%`[];
}>> = [
    { align: 'right', lineWidths: ['54%', '36%'] },
    { align: 'left', lineWidths: ['72%', '58%', '44%'] },
    { align: 'right', lineWidths: ['62%'] },
    { align: 'left', lineWidths: ['68%', '48%'] },
];

const stylesheet = StyleSheet.create((theme) => ({
    overlay: {
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        backgroundColor: theme.colors.surface.base,
        paddingTop: PLACEHOLDER_TOP_PADDING_PX,
        paddingHorizontal: PLACEHOLDER_HORIZONTAL_PADDING_PX,
    },
    rows: {
        gap: PLACEHOLDER_ROW_GAP_PX,
    },
    bubble: {
        maxWidth: '82%',
        borderRadius: PLACEHOLDER_BUBBLE_RADIUS_PX,
        backgroundColor: theme.colors.surface.inset,
        padding: PLACEHOLDER_BUBBLE_PADDING_PX,
        gap: PLACEHOLDER_BUBBLE_LINE_GAP_PX,
    },
    bubbleLeft: {
        alignSelf: 'flex-start',
    },
    bubbleRight: {
        alignSelf: 'flex-end',
    },
    line: {
        height: PLACEHOLDER_LINE_HEIGHT_PX,
        borderRadius: PLACEHOLDER_LINE_RADIUS_PX,
        backgroundColor: theme.colors.surface.pressedOverlay,
    },
    staticSurface: {
        flex: 1,
        opacity: 0.72,
    },
    activeSurface: {
        flex: 1,
    },
    spinner: {
        position: 'absolute',
        top: PLACEHOLDER_SPINNER_TOP_PX,
        alignSelf: 'center',
    },
}));

export type TranscriptFirstPaintPlaceholderProps = Readonly<{
    reducedMotion: boolean;
}>;

export function TranscriptFirstPaintPlaceholder(
    props: TranscriptFirstPaintPlaceholderProps,
): React.ReactElement {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const rows = (
        <View style={styles.rows}>
            {PLACEHOLDER_ROWS.map((row, rowIndex) => (
                <View
                    key={rowIndex}
                    style={[
                        styles.bubble,
                        row.align === 'left' ? styles.bubbleLeft : styles.bubbleRight,
                    ]}
                >
                    {row.lineWidths.map((width, lineIndex) => (
                        <View
                            key={lineIndex}
                            style={[styles.line, { width }]}
                        />
                    ))}
                </View>
            ))}
        </View>
    );

    return (
        <View
            testID="transcript-first-paint-placeholder"
            pointerEvents="none"
            style={styles.overlay}
            aria-hidden={true}
            accessibilityElementsHidden={true}
            importantForAccessibility="no-hide-descendants"
        >
            {props.reducedMotion ? (
                <View
                    testID="transcript-first-paint-placeholder:static"
                    style={styles.staticSurface}
                >
                    {rows}
                </View>
            ) : (
                <View
                    testID="transcript-first-paint-placeholder:active"
                    style={styles.activeSurface}
                >
                    {rows}
                    <ActivitySpinner
                        testID="transcript-first-paint-placeholder:spinner"
                        size="small"
                        color={theme.colors.text.secondary}
                        style={styles.spinner}
                    />
                </View>
            )}
        </View>
    );
}
