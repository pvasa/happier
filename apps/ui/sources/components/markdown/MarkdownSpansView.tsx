import { MarkdownSpan } from './parseMarkdown';
import { Link } from 'expo-router';
import * as React from 'react';
import { Platform } from 'react-native';
import { Text } from '../ui/text/Text';
import { StreamingTextReveal } from './streaming/StreamingTextReveal';
import type { StreamingTextRevealPreset } from './streaming/streamingTextRevealConfig';

export type MarkdownSpansViewProps = {
    spans: MarkdownSpan[];
    baseStyle?: any;
    linkStyle?: any;
    resolveSpanStyle?: (styleName: MarkdownSpan['styles'][number]) => any;
    streamingReveal?: boolean;
    streamingRevealPreset?: StreamingTextRevealPreset;
};

export const MarkdownSpansView = React.memo((props: MarkdownSpansViewProps) => {
    const resolveSpanStyle = props.resolveSpanStyle ?? (() => undefined);

    return (
        <>
            {props.spans.map((span, index) => {
                if (span.url) {
                    const isWeb = Platform.OS === 'web';
                    return (
                        <Link
                            key={index}
                            href={span.url as any}
                            target="_blank"
                            rel="noopener noreferrer"
                            // On web, avoid `asChild` so Expo Router can forward `href`/`target`/`rel` to an anchor-like
                            // element (RN Web `hrefAttrs`). On native, use `asChild` so selection works reliably.
                            asChild={!isWeb}
                            style={isWeb ? [props.linkStyle, span.styles.map(resolveSpanStyle)] : undefined}
                        >
                            {isWeb ? (
                                span.text
                            ) : (
                                <Text
                                    selectable
                                    style={[props.linkStyle, span.styles.map(resolveSpanStyle)]}
                                >
                                    {span.text}
                                </Text>
                            )}
                        </Link>
                    );
                }

                const spanStyle = [props.baseStyle, span.styles.map(resolveSpanStyle)];
                if (props.streamingReveal === true && !span.styles.includes('code')) {
                    return (
                        <StreamingTextReveal
                            key={index}
                            selectable
                            style={spanStyle}
                            text={span.text}
                            animated
                            preset={props.streamingRevealPreset}
                        />
                    );
                }

                return (
                    <Text
                        key={index}
                        selectable
                        style={spanStyle}
                    >
                        {span.text}
                    </Text>
                );
            })}
        </>
    );
});
