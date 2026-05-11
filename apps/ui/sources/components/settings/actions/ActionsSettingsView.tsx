import * as React from 'react';
import { Ionicons } from '@expo/vector-icons';
import { View, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { type ActionId } from '@happier-dev/protocol';

import { SearchHeader } from '@/components/ui/forms/SearchHeader';
import { Switch } from '@/components/ui/forms/Switch';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { ItemList } from '@/components/ui/lists/ItemList';
import { Text } from '@/components/ui/text/Text';
import { useFeatureEnabled } from '@/hooks/server/useFeatureEnabled';
import { useSetting, useSettingMutable } from '@/sync/domains/state/storage';
import { t } from '@/text';

import {
    buildActionSettingsEntries,
} from './buildActionSettingsEntries';
import {
    setActionEnabled,
} from './actionSettingsTargets';
import { normalizeActionsSettings } from './normalizeActionsSettings';

const stylesheet = StyleSheet.create((theme) => ({
    emptyState: {
        paddingHorizontal: Platform.select({ ios: 16, default: 14 }),
        paddingVertical: Platform.select({ ios: 16, default: 18 }),
    },
    emptyText: {
        color: theme.colors.textSecondary,
        fontSize: Platform.select({ ios: 15, default: 14 }),
        lineHeight: 20,
    },
}));

export const ActionsSettingsView = React.memo(function ActionsSettingsView() {
    const { theme } = useUnistyles();
    const router = useRouter();
    const styles = stylesheet;
    const [searchQuery, setSearchQuery] = React.useState('');
    const [rawSettings, setRawSettings] = useSettingMutable('actionsSettingsV1');
    const voice = useSetting('voice') as Readonly<{ privacy?: { shareDeviceInventory?: boolean } }> | null;
    const executionRunsEnabled = useFeatureEnabled('execution.runs');
    const memorySearchEnabled = useFeatureEnabled('memory.search');
    const voiceEnabled = useFeatureEnabled('voice');
    const sessionHandoffEnabled = useFeatureEnabled('sessions.handoff');
    const mcpServersEnabled = useFeatureEnabled('mcp.servers');

    const settings = React.useMemo(() => normalizeActionsSettings(rawSettings), [rawSettings]);
    const availability = React.useMemo(() => ({
        executionRunsEnabled,
        memorySearchEnabled,
        voiceEnabled,
        sessionHandoffEnabled,
        mcpServersEnabled,
        voiceShareDeviceInventory: voice?.privacy?.shareDeviceInventory !== false,
    }), [executionRunsEnabled, memorySearchEnabled, voice?.privacy?.shareDeviceInventory, voiceEnabled, sessionHandoffEnabled, mcpServersEnabled]);

    const entries = React.useMemo(() => buildActionSettingsEntries({
        query: searchQuery,
        settings,
        availability,
        translate: t,
    }), [availability, searchQuery, settings]);

    const commitSettings = React.useCallback((next: unknown) => {
        setRawSettings(normalizeActionsSettings(next));
    }, [setRawSettings]);

    const handleActionEnabledChange = React.useCallback((actionId: ActionId, enabled: boolean) => {
        commitSettings(setActionEnabled({ settings, actionId, enabled }));
    }, [commitSettings, settings]);

    const openActionDetails = React.useCallback((actionId: ActionId) => {
        router.push(`/settings/actions/${encodeURIComponent(actionId)}`);
    }, [router]);

    return (
        <ItemList style={{ paddingTop: 0 }}>
            <SearchHeader
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder={t('settingsActions.searchPlaceholder')}
            />

            {entries.length === 0 ? (
                <ItemGroup>
                    <View style={styles.emptyState}>
                        <Text style={styles.emptyText}>{t('settingsActions.noResults')}</Text>
                    </View>
                </ItemGroup>
            ) : null}

            {entries.length > 0 ? (
                <ItemGroup title={t('common.actions')} footer={t('settingsActions.aboutFooter')}>
                    {entries.map((entry) => {
                        const actionEnabled = entry.enabled;
                        const actionTestIdPrefix = `settings-actions:action:${entry.actionId}`;

                        return (
                        <Item
                            key={entry.actionId}
                            testID={actionTestIdPrefix}
                            title={entry.title}
                            subtitle={entry.description ?? t('settingsActions.noDescription')}
                            detail={actionEnabled ? t('common.enabled') : t('common.disabled')}
                            icon={(
                                <Ionicons
                                    name={actionEnabled ? 'flash-outline' : 'flash-off-outline'}
                                    size={29}
                                    color={actionEnabled ? theme.colors.success : theme.colors.warningCritical}
                                />
                            )}
                            rightElement={(
                                <Switch
                                    testID={`${actionTestIdPrefix}:enabled`}
                                    value={actionEnabled}
                                    onValueChange={(nextValue) => handleActionEnabledChange(entry.actionId, nextValue)}
                                />
                            )}
                            showChevron
                            onPress={() => openActionDetails(entry.actionId)}
                        />
                        );
                    })}
                </ItemGroup>
            ) : null}
        </ItemList>
    );
});
