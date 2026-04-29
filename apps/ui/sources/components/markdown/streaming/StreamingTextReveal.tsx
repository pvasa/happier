import * as React from 'react';
import type { StyleProp, TextStyle } from 'react-native';
import { Platform } from 'react-native';

import { Text } from '@/components/ui/text/Text';
import { resolveStreamingTextRevealConfig, type StreamingTextRevealPreset } from './streamingTextRevealConfig';

const REVEAL_STYLE_ID = 'happier-streaming-markdown-reveal-style';
const REVEAL_TRANSLATE_Y_VAR = '--happier-streaming-markdown-reveal-y';

let revealStyleInjected = false;

function injectRevealStyle(): void {
    if (revealStyleInjected || Platform.OS !== 'web') return;
    if (typeof document === 'undefined') return;

    revealStyleInjected = true;
    if (document.getElementById(REVEAL_STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = REVEAL_STYLE_ID;
    style.textContent = [
        '@keyframes happierMarkdownWordReveal {',
        `  from { opacity: 0; transform: translateY(var(${REVEAL_TRANSLATE_Y_VAR}, 2px)); }`,
        '  to { opacity: 1; transform: translateY(0); }',
        '}',
    ].join('\n');
    document.head.appendChild(style);
}

function splitTextForReveal(text: string): string[] {
    return text.split(/(\s+)/).filter((part) => part.length > 0);
}

function readCommonPrefixLength(a: string, b: string): number {
    const max = Math.min(a.length, b.length);
    let index = 0;
    while (index < max && a[index] === b[index]) {
        index++;
    }
    return index;
}

export function StreamingTextReveal(props: {
    text: string;
    selectable?: boolean;
    style?: StyleProp<TextStyle>;
    animated?: boolean;
    preset?: StreamingTextRevealPreset;
}) {
    const revealConfig = resolveStreamingTextRevealConfig({
        animated: props.animated,
        preset: props.preset,
    });
    const previousTextRef = React.useRef('');
    const commonPrefixLength = readCommonPrefixLength(previousTextRef.current, props.text);
    const parts = React.useMemo(() => splitTextForReveal(props.text), [props.text]);

    React.useEffect(() => {
        previousTextRef.current = props.text;
    }, [props.text]);

    React.useEffect(() => {
        if (revealConfig == null) return;
        injectRevealStyle();
    }, [revealConfig]);

    if (Platform.OS !== 'web' || revealConfig == null) {
        return (
            <Text selectable={props.selectable} style={props.style}>
                {props.text}
            </Text>
        );
    }

    let cursor = 0;
    return (
        <Text selectable={props.selectable} style={props.style}>
            {parts.map((part, index) => {
                const start = cursor;
                const end = start + part.length;
                cursor = end;

                if (/^\s+$/.test(part)) {
                    return part;
                }

                if (end <= commonPrefixLength) {
                    return part;
                }

                return React.createElement(
                    'span',
                    {
                        key: index,
                        'data-happier-streaming-text-reveal': 'word',
                        style: {
                            [REVEAL_TRANSLATE_Y_VAR]: `${revealConfig.translateYPx}px`,
                            animationName: 'happierMarkdownWordReveal',
                            animationDuration: `${revealConfig.durationMs}ms`,
                            animationTimingFunction: revealConfig.easing,
                            animationFillMode: 'both',
                            display: 'inline-block',
                        },
                    },
                    part,
                );
            })}
        </Text>
    );
}
