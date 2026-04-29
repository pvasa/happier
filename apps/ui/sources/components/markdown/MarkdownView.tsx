import * as React from 'react';
import type { StyleProp, TextStyle } from 'react-native';
import { View } from 'react-native';

import { MarkdownBlockView, type Option } from './MarkdownBlockView';
import type { StreamingTextRevealPreset } from './streaming/streamingTextRevealConfig';
import { useStreamingMarkdownBlocks, type MarkdownStreamingMode } from './streaming/useStreamingMarkdownBlocks';

export type { Option };

export const MarkdownView = React.memo((props: {
    testID?: string;
    markdown: string;
    onOptionPress?: (option: Option) => void;
    textStyle?: StyleProp<TextStyle>;
    variant?: 'default' | 'thinking';
    streamingMode?: MarkdownStreamingMode;
    streamingAnimated?: boolean;
    streamingRevealPreset?: StreamingTextRevealPreset;
}) => {
    const blocks = useStreamingMarkdownBlocks({
        markdown: props.markdown,
        mode: props.streamingMode === 'streaming' ? 'streaming' : 'static',
    });

    const variant: 'default' | 'thinking' = props.variant === 'thinking' ? 'thinking' : 'default';
    const streamingReveal = props.streamingMode === 'streaming' && props.streamingAnimated === true;

    return (
        <View testID={props.testID} style={styles.root}>
            {blocks.map((block, index) => (
                <MarkdownBlockView
                    key={index}
                    block={block}
                    first={index === 0}
                    last={index === blocks.length - 1}
                    selectable
                    textStyle={props.textStyle}
                    variant={variant}
                    streamingReveal={streamingReveal}
                    streamingRevealPreset={props.streamingRevealPreset}
                    onOptionPress={props.onOptionPress}
                />
            ))}
        </View>
    );
});

const styles = {
    root: {
        width: '100%' as const,
    },
};
