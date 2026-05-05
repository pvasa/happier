import { Ionicons } from '@expo/vector-icons';
import * as React from 'react';
import {
    I18nManager,
    Pressable,
    View,
    type StyleProp,
    type ViewStyle,
} from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

import type { PetCompanionTrayItem } from '@/components/pets/activity';
import { Text, TextInput } from '@/components/ui/text/Text';
import { shadowLevelStyle } from '@/shadowElevation';
import { t } from '@/text';
import { toTestIdSafeValue } from '@/utils/ui/toTestIdSafeValue';

import { styles, trayFadeStyle } from './desktopPetOverlayTrayStyles';

const noDragProps = {
    'data-pet-no-drag': 'true',
    dataSet: { petNoDrag: 'true' },
    className: 'no-drag',
} as const;

type DesktopPetOverlayTrayProps = Readonly<{
    items: readonly PetCompanionTrayItem[];
    open: boolean;
    onOpenItem: (item: PetCompanionTrayItem) => void | Promise<void>;
    onDismissItem: (item: PetCompanionTrayItem) => void;
    onQuickReply: (item: PetCompanionTrayItem, message: string) => void | Promise<void>;
    style?: StyleProp<ViewStyle>;
}>;

function resolveStatusLabel(status: PetCompanionTrayItem['status']): string {
    switch (status) {
        case 'waiting':
            return t('settingsPets.overlayStatusWaiting');
        case 'failed':
            return t('settingsPets.overlayStatusFailed');
        case 'review':
            return t('settingsPets.overlayStatusReview');
        case 'running':
            return t('settingsPets.overlayStatusRunning');
    }
}

function resolveStatusIcon(status: PetCompanionTrayItem['status']): React.ComponentProps<typeof Ionicons>['name'] {
    switch (status) {
        case 'waiting':
            return 'time-outline';
        case 'failed':
            return 'warning-outline';
        case 'review':
            return 'checkmark-circle';
        case 'running':
            return 'ellipse-outline';
    }
}

function resolveStatusColor(
    status: PetCompanionTrayItem['status'],
    theme: ReturnType<typeof useUnistyles>['theme'],
): string {
    switch (status) {
        case 'waiting':
            return theme.colors.status.actionRequired;
        case 'failed':
            return theme.colors.status.error;
        case 'review':
            return theme.colors.success;
        case 'running':
            return theme.colors.status.connected;
    }
}

function DesktopPetOverlayTrayItemCard(props: Readonly<{
    item: PetCompanionTrayItem;
    active: boolean;
    replyOpen: boolean;
    onActiveChange: (item: PetCompanionTrayItem, active: boolean) => void;
    onReplyOpenChange: (item: PetCompanionTrayItem, open: boolean) => void;
    onOpen: (item: PetCompanionTrayItem) => void | Promise<void>;
    onDismiss: (item: PetCompanionTrayItem) => void;
    onQuickReply: (item: PetCompanionTrayItem, message: string) => void | Promise<void>;
}>): React.ReactElement {
    const { theme } = useUnistyles();
    const [draft, setDraft] = React.useState('');
    const safeSessionId = toTestIdSafeValue(props.item.sessionId);
    const statusLabel = resolveStatusLabel(props.item.status);
    const statusColor = resolveStatusColor(props.item.status, theme);
    const statusIcon = resolveStatusIcon(props.item.status);
    const bubbleTheme = theme.colors.desktopPetOverlay.bubble;
    const writingDirection = I18nManager.isRTL ? 'rtl' : 'ltr';
    const replyOpen = props.replyOpen;
    const active = props.active || replyOpen;
    const handleSend = React.useCallback(async () => {
        const message = draft.trim();
        if (!message) return;
        await props.onQuickReply(props.item, message);
        setDraft('');
    }, [draft, props]);

    return (
        <Pressable
            {...noDragProps}
            testID={`desktop-pet-overlay-tray-item-${safeSessionId}`}
            data-pet-collapsed={active ? 'false' : 'true'}
            data-pet-reply-expanded={replyOpen ? 'true' : 'false'}
            accessibilityRole="button"
            accessibilityLabel={`${statusLabel}: ${props.item.title}`}
            onHoverIn={() => props.onActiveChange(props.item, true)}
            onHoverOut={() => props.onActiveChange(props.item, false)}
            onFocus={() => props.onActiveChange(props.item, true)}
            onBlur={() => props.onActiveChange(props.item, false)}
            onPress={() => {
                void props.onOpen(props.item);
            }}
            style={({ pressed }) => [
                styles.item,
                replyOpen ? styles.itemReplyOpen : null,
                shadowLevelStyle(theme.colors.shadowLevels[3]),
                {
                    backgroundColor: pressed ? bubbleTheme.backgroundPressed : bubbleTheme.background,
                },
            ]}
        >
            <View
                {...noDragProps}
                testID={`desktop-pet-overlay-tray-status-${safeSessionId}`}
                data-pet-status-icon={statusIcon}
                accessibilityLabel={statusLabel}
                style={styles.statusBadge}
            >
                <Ionicons name={statusIcon} size={12} color={statusColor} />
            </View>
            <Pressable
                {...noDragProps}
                testID={`desktop-pet-overlay-tray-dismiss-${safeSessionId}`}
                pointerEvents={active ? 'auto' : 'none'}
                accessibilityRole="button"
                accessibilityLabel={t('settingsPets.overlayDismissAction')}
                onPress={(event) => {
                    event?.stopPropagation?.();
                    props.onDismiss(props.item);
                }}
                style={({ pressed }) => [
                    styles.iconButton,
                    I18nManager.isRTL ? styles.iconButtonRtl : null,
                    active ? styles.visibleAction : styles.hiddenAction,
                    { backgroundColor: pressed ? bubbleTheme.controlBackgroundPressed : bubbleTheme.controlBackground },
                ]}
            >
                <Ionicons name="close" size={13} color={bubbleTheme.textSecondary} />
            </Pressable>
            <View style={styles.copy}>
                <Text
                    numberOfLines={1}
                    style={[styles.title, { color: bubbleTheme.text, writingDirection }]}
                >
                    {props.item.title}
                </Text>
                {props.item.subtitle ? (
                    <Text
                        numberOfLines={active ? 2 : 1}
                        style={[
                            styles.subtitle,
                            { color: bubbleTheme.textSecondary, writingDirection },
                        ]}
                    >
                        {props.item.subtitle}
                    </Text>
                ) : null}
            </View>
            <Pressable
                {...noDragProps}
                testID={`desktop-pet-overlay-tray-reply-action-${safeSessionId}`}
                pointerEvents={active && !replyOpen ? 'auto' : 'none'}
                accessibilityRole="button"
                accessibilityLabel={t('settingsPets.overlayReplyAction')}
                onPress={(event) => {
                    event?.stopPropagation?.();
                    props.onReplyOpenChange(props.item, true);
                }}
                style={({ pressed }) => [
                    styles.replyAction,
                    active && !replyOpen ? styles.visibleAction : styles.hiddenAction,
                    { backgroundColor: pressed ? bubbleTheme.controlBackgroundPressed : bubbleTheme.controlBackground },
                ]}
            >
                <Text
                    disableUiFontScaling={true}
                    style={[styles.replyActionText, { color: bubbleTheme.text }]}
                >
                    {t('settingsPets.overlayReplyAction')}
                </Text>
            </Pressable>
            <View
                {...noDragProps}
                testID={`desktop-pet-overlay-tray-reply-row-${safeSessionId}`}
                accessibilityElementsHidden={!replyOpen}
                importantForAccessibility={replyOpen ? 'auto' : 'no-hide-descendants'}
                style={[
                    styles.replyRow,
                    replyOpen ? styles.replyRowExpanded : styles.replyRowCollapsed,
                    I18nManager.isRTL ? styles.rowReverse : null,
                ]}
            >
                {replyOpen ? (
                    <>
                        <TextInput
                            {...noDragProps}
                            testID={`desktop-pet-overlay-tray-reply-input-${safeSessionId}`}
                            accessibilityLabel={t('settingsPets.overlayQuickReplyPlaceholder')}
                            placeholder={t('settingsPets.overlayQuickReplyPlaceholder')}
                            value={draft}
                            onChangeText={setDraft}
                            style={[
                                styles.replyInput,
                                {
                                    backgroundColor: theme.colors.input.background,
                                    color: theme.colors.input.text,
                                    borderColor: theme.colors.divider,
                                    writingDirection,
                                },
                            ]}
                            placeholderTextColor={theme.colors.input.placeholder}
                        />
                        <Pressable
                            {...noDragProps}
                            testID={`desktop-pet-overlay-tray-reply-send-${safeSessionId}`}
                            accessibilityRole="button"
                            accessibilityLabel={t('settingsPets.overlayQuickReplyAction')}
                            disabled={!draft.trim()}
                            onPress={(event) => {
                                event?.stopPropagation?.();
                                void handleSend();
                            }}
                            style={({ pressed }) => [
                                styles.sendButton,
                                {
                                    backgroundColor: pressed ? bubbleTheme.controlBackgroundPressed : bubbleTheme.controlBackground,
                                    borderColor: draft.trim() ? theme.colors.accent.blue : theme.colors.divider,
                                },
                            ]}
                        >
                            <Ionicons name="send" size={14} color={draft.trim() ? theme.colors.accent.blue : theme.colors.textSecondary} />
                        </Pressable>
                    </>
                ) : null}
            </View>
        </Pressable>
    );
}

export function DesktopPetOverlayTray(props: DesktopPetOverlayTrayProps): React.ReactElement | null {
    const [activeItemId, setActiveItemId] = React.useState<string | null>(null);
    const [replyItemId, setReplyItemId] = React.useState<string | null>(null);
    const handleActiveChange = React.useCallback((item: PetCompanionTrayItem, active: boolean) => {
        setActiveItemId((current) => {
            if (active) return item.id;
            return current === item.id ? null : current;
        });
    }, []);
    const handleReplyOpenChange = React.useCallback((item: PetCompanionTrayItem, open: boolean) => {
        setReplyItemId(open ? item.id : null);
        if (open) {
            setActiveItemId(item.id);
        }
    }, []);
    if (props.items.length === 0) return null;

    return (
        <View
            {...noDragProps}
            testID="desktop-pet-overlay-tray"
            data-pet-tray-open={props.open ? 'true' : 'false'}
            pointerEvents={props.open ? 'auto' : 'none'}
            accessibilityElementsHidden={!props.open}
            importantForAccessibility={props.open ? 'auto' : 'no-hide-descendants'}
            accessibilityLiveRegion="polite"
            accessibilityLabel={t('settingsPets.overlayTrayTitle')}
            style={[
                styles.root,
                trayFadeStyle,
                props.style,
                props.open ? styles.rootOpen : styles.rootCollapsed,
            ]}
        >
            {props.items.map((item) => (
                <DesktopPetOverlayTrayItemCard
                    key={item.id}
                    item={item}
                    active={activeItemId === item.id}
                    replyOpen={replyItemId === item.id}
                    onActiveChange={handleActiveChange}
                    onReplyOpenChange={handleReplyOpenChange}
                    onOpen={props.onOpenItem}
                    onDismiss={props.onDismissItem}
                    onQuickReply={props.onQuickReply}
                />
            ))}
        </View>
    );
}
