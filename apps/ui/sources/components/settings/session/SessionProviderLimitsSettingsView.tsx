import * as React from 'react';
import { Ionicons } from '@expo/vector-icons';
import { useUnistyles } from 'react-native-unistyles';

import { DropdownMenu } from '@/components/ui/forms/dropdown/DropdownMenu';
import { Switch } from '@/components/ui/forms/Switch';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { ItemList } from '@/components/ui/lists/ItemList';
import { t } from '@/text';
import { useFeatureEnabled } from '@/hooks/server/useFeatureEnabled';
import { useSettingMutable } from '@/sync/domains/state/storage';

export const SessionProviderLimitsSettingsView = React.memo(function SessionProviderLimitsSettingsView() {
    const { theme } = useUnistyles();
    const popoverBoundaryRef = React.useRef<any>(null);
    const usageLimitRecoveryEnabled = useFeatureEnabled('sessions.usageLimitRecovery');
    const connectedServiceQuotasEnabled = useFeatureEnabled('connectedServices.quotas');
    const [usageLimitRecoverySettingsV1, setUsageLimitRecoverySettingsV1] = useSettingMutable('usageLimitRecoverySettingsV1');
    const [sessionProviderUsageGaugeMode, setSessionProviderUsageGaugeMode] = useSettingMutable('sessionProviderUsageGaugeMode');
    const [sessionProviderUsageGaugeWindowMode, setSessionProviderUsageGaugeWindowMode] = useSettingMutable('sessionProviderUsageGaugeWindowMode');
    const [openUsageLimitRecoveryMenu, setOpenUsageLimitRecoveryMenu] = React.useState(false);
    const [openUsageLimitRecoveryResumePromptMenu, setOpenUsageLimitRecoveryResumePromptMenu] = React.useState(false);
    const [openProviderUsageGaugeWindowMenu, setOpenProviderUsageGaugeWindowMenu] = React.useState(false);
    const usageLimitRecoveryMode = usageLimitRecoverySettingsV1?.mode === 'auto_wait' ? 'auto_wait' : 'ask';
    const usageLimitRecoveryResumePromptMode = usageLimitRecoverySettingsV1?.resumePromptMode === 'off' ? 'off' : 'standard';
    const usageLimitRecoveryModeRef = React.useRef<'ask' | 'auto_wait'>(usageLimitRecoveryMode);
    const usageLimitRecoveryResumePromptModeRef = React.useRef<'standard' | 'off'>(usageLimitRecoveryResumePromptMode);
    usageLimitRecoveryModeRef.current = usageLimitRecoveryMode;
    usageLimitRecoveryResumePromptModeRef.current = usageLimitRecoveryResumePromptMode;
    const providerUsageGaugeVisible = sessionProviderUsageGaugeMode !== 'hidden';
    const providerUsageGaugeWindowMode =
        sessionProviderUsageGaugeWindowMode === 'daily'
        || sessionProviderUsageGaugeWindowMode === 'weekly'
        || sessionProviderUsageGaugeWindowMode === 'session'
        || sessionProviderUsageGaugeWindowMode === 'primary'
        || sessionProviderUsageGaugeWindowMode === 'secondary'
            ? sessionProviderUsageGaugeWindowMode
            : 'most_constrained';
    const usageLimitRecoveryOptions = [
        { id: 'ask', title: t('settingsSession.usageLimitRecovery.askTitle'), subtitle: t('settingsSession.usageLimitRecovery.askSubtitle') },
        { id: 'auto_wait', title: t('settingsSession.usageLimitRecovery.autoWaitTitle'), subtitle: t('settingsSession.usageLimitRecovery.autoWaitSubtitle') },
    ];
    const resumePromptOptions = [
        { id: 'standard', title: t('settingsSession.usageLimitRecovery.resumePromptStandardTitle'), subtitle: t('settingsSession.usageLimitRecovery.resumePromptStandardSubtitle') },
        { id: 'off', title: t('settingsSession.usageLimitRecovery.resumePromptOffTitle'), subtitle: t('settingsSession.usageLimitRecovery.resumePromptOffSubtitle') },
    ];
    const providerUsageGaugeWindowOptions = [
        { id: 'most_constrained', title: t('settingsSession.providerUsageGauge.windowMostConstrainedTitle'), subtitle: t('settingsSession.providerUsageGauge.windowMostConstrainedSubtitle') },
        { id: 'daily', title: t('settingsSession.providerUsageGauge.windowDailyTitle'), subtitle: t('settingsSession.providerUsageGauge.windowDailySubtitle') },
        { id: 'weekly', title: t('settingsSession.providerUsageGauge.windowWeeklyTitle'), subtitle: t('settingsSession.providerUsageGauge.windowWeeklySubtitle') },
        { id: 'session', title: t('settingsSession.providerUsageGauge.windowSessionTitle'), subtitle: t('settingsSession.providerUsageGauge.windowSessionSubtitle') },
        { id: 'primary', title: t('settingsSession.providerUsageGauge.windowPrimaryTitle'), subtitle: t('settingsSession.providerUsageGauge.windowPrimarySubtitle') },
        { id: 'secondary', title: t('settingsSession.providerUsageGauge.windowSecondaryTitle'), subtitle: t('settingsSession.providerUsageGauge.windowSecondarySubtitle') },
    ] as const;

    return (
        <ItemList ref={popoverBoundaryRef} style={{ paddingTop: 0 }}>
            {usageLimitRecoveryEnabled ? (
                <ItemGroup title={t('settingsSession.usageLimitRecovery.title')} footer={t('settingsSession.usageLimitRecovery.footer')}>
                    <DropdownMenu
                        open={openUsageLimitRecoveryMenu}
                        onOpenChange={setOpenUsageLimitRecoveryMenu}
                        variant="selectable"
                        search={false}
                        selectedId={usageLimitRecoveryMode}
                        showCategoryTitles={false}
                        matchTriggerWidth={true}
                        connectToTrigger={true}
                        rowKind="item"
                        popoverBoundaryRef={popoverBoundaryRef}
                        itemTrigger={{
                            title: t('settingsSession.usageLimitRecovery.modeTitle'),
                            subtitle: usageLimitRecoveryMode === 'auto_wait'
                                ? t('settingsSession.usageLimitRecovery.autoWaitSelectedSubtitle')
                                : t('settingsSession.usageLimitRecovery.askSelectedSubtitle'),
                            icon: <Ionicons name="timer-outline" size={29} color={theme.colors.accent.indigo} />,
                            showSelectedSubtitle: false,
                            itemProps: { testID: 'settings-session-usageLimitRecovery-trigger' },
                        }}
                        items={usageLimitRecoveryOptions}
                        onSelect={(id) => {
                            if (id !== 'ask' && id !== 'auto_wait') return;
                            usageLimitRecoveryModeRef.current = id;
                            setUsageLimitRecoverySettingsV1({ v: 1, mode: id, promptMode: 'standard', resumePromptMode: usageLimitRecoveryResumePromptModeRef.current });
                            setOpenUsageLimitRecoveryMenu(false);
                        }}
                    />
                    <DropdownMenu
                        open={openUsageLimitRecoveryResumePromptMenu}
                        onOpenChange={setOpenUsageLimitRecoveryResumePromptMenu}
                        variant="selectable"
                        search={false}
                        selectedId={usageLimitRecoveryResumePromptMode}
                        showCategoryTitles={false}
                        matchTriggerWidth={true}
                        connectToTrigger={true}
                        rowKind="item"
                        popoverBoundaryRef={popoverBoundaryRef}
                        itemTrigger={{
                            title: t('settingsSession.usageLimitRecovery.resumePromptTitle'),
                            subtitle: usageLimitRecoveryResumePromptMode === 'off'
                                ? t('settingsSession.usageLimitRecovery.resumePromptOffSelectedSubtitle')
                                : t('settingsSession.usageLimitRecovery.resumePromptStandardSelectedSubtitle'),
                            icon: <Ionicons name="chatbubble-ellipses-outline" size={29} color={theme.colors.accent.indigo} />,
                            showSelectedSubtitle: false,
                            itemProps: { testID: 'settings-session-usageLimitRecovery-resumePrompt-trigger' },
                        }}
                        items={resumePromptOptions}
                        onSelect={(id) => {
                            if (id !== 'standard' && id !== 'off') return;
                            usageLimitRecoveryResumePromptModeRef.current = id;
                            setUsageLimitRecoverySettingsV1({ v: 1, mode: usageLimitRecoveryModeRef.current, promptMode: 'standard', resumePromptMode: id });
                            setOpenUsageLimitRecoveryResumePromptMenu(false);
                        }}
                    />
                </ItemGroup>
            ) : null}

            {connectedServiceQuotasEnabled ? (
                <ItemGroup title={t('settingsSession.providerUsageGauge.title')} footer={t('settingsSession.providerUsageGauge.footer')}>
                    <Item
                        testID="settings-session-providerUsageGauge-visibility"
                        title={t('settingsSession.providerUsageGauge.visibilityTitle')}
                        subtitle={providerUsageGaugeVisible
                            ? t('settingsSession.providerUsageGauge.visibilityEnabledSubtitle')
                            : t('settingsSession.providerUsageGauge.visibilityHiddenSubtitle')}
                        icon={<Ionicons name="speedometer-outline" size={29} color={theme.colors.accent.indigo} />}
                        rightElement={<Switch testID="settings-session-providerUsageGauge-visibility-toggle" value={providerUsageGaugeVisible} onValueChange={(next) => setSessionProviderUsageGaugeMode(next ? 'auto' : 'hidden')} />}
                        showChevron={false}
                        onPress={() => setSessionProviderUsageGaugeMode(providerUsageGaugeVisible ? 'hidden' : 'auto')}
                    />
                    <DropdownMenu
                        open={openProviderUsageGaugeWindowMenu}
                        onOpenChange={setOpenProviderUsageGaugeWindowMenu}
                        variant="selectable"
                        search={false}
                        selectedId={providerUsageGaugeWindowMode}
                        showCategoryTitles={false}
                        matchTriggerWidth={true}
                        connectToTrigger={true}
                        rowKind="item"
                        popoverBoundaryRef={popoverBoundaryRef}
                        itemTrigger={{
                            title: t('settingsSession.providerUsageGauge.windowTitle'),
                            subtitle: providerUsageGaugeWindowOptions.find((option) => option.id === providerUsageGaugeWindowMode)?.title ?? t('settingsSession.providerUsageGauge.windowMostConstrainedTitle'),
                            icon: <Ionicons name="analytics-outline" size={29} color={theme.colors.accent.blue} />,
                            showSelectedSubtitle: false,
                            itemProps: { testID: 'settings-session-providerUsageGauge-window-trigger' },
                        }}
                        items={providerUsageGaugeWindowOptions}
                        onSelect={(id) => {
                            if (!providerUsageGaugeWindowOptions.some((option) => option.id === id)) return;
                            setSessionProviderUsageGaugeWindowMode(id as typeof providerUsageGaugeWindowOptions[number]['id']);
                            setOpenProviderUsageGaugeWindowMenu(false);
                        }}
                    />
                </ItemGroup>
            ) : null}
        </ItemList>
    );
});

export default SessionProviderLimitsSettingsView;
