import * as React from 'react';
import { Platform, Pressable, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Svg, Circle } from 'react-native-svg';

import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import { Text } from '@/components/ui/text/Text';

import {
    formatContextTokenCount,
    formatContextUsagePercent,
    type ContextUsageState,
} from '../contextWarning';
import { AgentInputContentPopover } from './AgentInputContentPopover';

type WebHoverablePressableState = Readonly<{
    pressed: boolean;
    hovered?: boolean;
}>;

type AgentInputContextUsageBadgeProps = Readonly<{
    state: ContextUsageState;
    marginLeft?: number;
}>;

function resolveToneColor(params: Readonly<{
    severity: ContextUsageState['severity'];
    neutralColor: string;
    warningColor: string;
    criticalColor: string;
}>): string {
    if (params.severity === 'critical') return params.criticalColor;
    if (params.severity === 'warning') return params.warningColor;
    return params.neutralColor;
}

export function AgentInputContextUsageBadge(props: AgentInputContextUsageBadgeProps) {
    const { theme } = useUnistyles();
    const styles = stylesheet;
    const anchorRef = React.useRef<any>(null);
    const [isPinnedOpen, setIsPinnedOpen] = React.useState(false);
    const [isHovered, setIsHovered] = React.useState(false);
    const ringSize = 20;
    const ringStrokeWidth = 2;
    const ringRadius = (ringSize - ringStrokeWidth) / 2;
    const ringCircumference = 2 * Math.PI * ringRadius;

    const toneColor = React.useMemo(
        () => resolveToneColor({
            severity: props.state.severity,
            neutralColor: theme.colors.textSecondary,
            warningColor: theme.colors.warning,
            criticalColor: theme.colors.warningCritical,
        }),
        [props.state.severity, theme.colors.textSecondary, theme.colors.warning, theme.colors.warningCritical],
    );
    const ringTrackColor = theme.colors.divider;
    const progressRatio = React.useMemo(
        () => Math.max(0, Math.min(props.state.usedRatio, 1)),
        [props.state.usedRatio],
    );
    const ringDashOffset = React.useMemo(
        () => ringCircumference * (1 - progressRatio),
        [progressRatio, ringCircumference],
    );
    const badgeValueLabel = React.useMemo(
        () => String(Math.max(0, Math.round(props.state.usedPercentage))),
        [props.state.usedPercentage],
    );
    const usedPercentageLabel = React.useMemo(
        () => formatContextUsagePercent(props.state.usedPercentage),
        [props.state.usedPercentage],
    );
    const usedTokensLabel = React.useMemo(
        () => formatContextTokenCount(props.state.usedTokens),
        [props.state.usedTokens],
    );
    const contextWindowTokensLabel = React.useMemo(
        () => formatContextTokenCount(props.state.contextWindowTokens),
        [props.state.contextWindowTokens],
    );
    const popoverDetail = React.useMemo(
        () => t('agentInput.context.usedDetail', {
            percent: usedPercentageLabel,
            used: usedTokensLabel,
            total: contextWindowTokensLabel,
        }),
        [contextWindowTokensLabel, usedPercentageLabel, usedTokensLabel],
    );
    const open = isPinnedOpen || isHovered;

    return (
        <>
            <Pressable
                ref={anchorRef}
                testID="agent-input-context-usage-badge"
                accessibilityRole="button"
                accessibilityLabel={popoverDetail}
                onPress={() => {
                    setIsPinnedOpen((previous) => !previous);
                }}
                onHoverIn={Platform.OS === 'web' ? () => setIsHovered(true) : undefined}
                onHoverOut={Platform.OS === 'web' ? () => setIsHovered(false) : undefined}
                style={(state) => {
                    const hovered = (state as WebHoverablePressableState).hovered === true;
                    return [
                        styles.badge,
                        {
                            marginLeft: props.marginLeft ?? 0,
                        },
                        (state.pressed || hovered) ? styles.badgePressed : null,
                    ];
                }}
            >
                <Svg
                    testID="agent-input-context-usage-ring"
                    width={ringSize}
                    height={ringSize}
                    viewBox={`0 0 ${ringSize} ${ringSize}`}
                    style={styles.badgeRing}
                >
                    <Circle
                        cx={ringSize / 2}
                        cy={ringSize / 2}
                        r={ringRadius}
                        fill="none"
                        stroke={ringTrackColor}
                        strokeWidth={ringStrokeWidth}
                    />
                    <Circle
                        cx={ringSize / 2}
                        cy={ringSize / 2}
                        r={ringRadius}
                        fill="none"
                        stroke={toneColor}
                        strokeWidth={ringStrokeWidth}
                        strokeLinecap="round"
                        strokeDasharray={`${ringCircumference} ${ringCircumference}`}
                        strokeDashoffset={ringDashOffset}
                        transform={`rotate(-90 ${ringSize / 2} ${ringSize / 2})`}
                    />
                </Svg>
                <View pointerEvents="none" style={styles.badgeLabelOverlay}>
                    <Text
                        testID="agent-input-context-usage-value"
                        style={[
                            styles.badgeLabel,
                            {
                                color: toneColor,
                            },
                        ]}
                    >
                        {badgeValueLabel}
                    </Text>
                </View>
            </Pressable>

            <AgentInputContentPopover
                open={open}
                anchorRef={anchorRef}
                onRequestClose={() => {
                    setIsPinnedOpen(false);
                    setIsHovered(false);
                }}
                maxWidthCap={340}
                scrollEnabled={false}
                content={(
                    <View testID="agent-input-context-usage-popover" style={styles.popoverContent}>
                        <Text style={styles.popoverTitle}>
                            {t('agentInput.context.windowTitle')}
                        </Text>
                        <Text testID="agent-input-context-usage-popover-detail" style={styles.popoverDetail}>
                            {popoverDetail}
                        </Text>
                        <Text testID="agent-input-context-usage-popover-description" style={styles.popoverDescription}>
                            {t('agentInput.context.description')}
                        </Text>
                    </View>
                )}
            />
        </>
    );
}

const stylesheet = StyleSheet.create((theme) => ({
    badge: {
        position: 'relative',
        width: 20,
        height: 20,
        borderRadius: 999,
        justifyContent: 'center',
        alignItems: 'center',
    },
    badgePressed: {
        opacity: 0.9,
    },
    badgeRing: {
        position: 'absolute',
        top: 0,
        left: 0,
    },
    badgeLabelOverlay: {
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        justifyContent: 'center',
        alignItems: 'center',
    },
    badgeLabel: {
        fontSize: 8,
        lineHeight: 8,
        textAlign: 'center',
        ...Typography.default(),
    },
    popoverContent: {
        paddingHorizontal: 16,
        paddingVertical: 14,
        gap: 10,
    },
    popoverTitle: {
        fontSize: 11,
        letterSpacing: 1,
        textTransform: 'uppercase',
        color: theme.colors.textSecondary,
        ...Typography.header(),
    },
    popoverDetail: {
        fontSize: 13,
        color: theme.colors.text,
        ...Typography.default(),
    },
    popoverDescription: {
        fontSize: 12,
        color: theme.colors.textSecondary,
        ...Typography.default(),
    },
}));
