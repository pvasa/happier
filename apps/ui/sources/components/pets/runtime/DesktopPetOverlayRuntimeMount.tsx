import * as React from 'react';
import { Platform } from 'react-native';

import {
    resolveDesktopPetOverlayGeometry,
} from '@/components/pets/desktop/desktopPetOverlayGeometry';
import { DesktopPetOverlayRuntime } from '@/components/pets/desktop/runtime/DesktopPetOverlayRuntime';
import { isDesktopPetOverlayWindowContext } from '@/components/pets/desktop/runtime/isDesktopPetOverlayWindowContext';
import { resolveDesktopPetOverlayPolicy } from '@/components/pets/desktop/policy/resolveDesktopPetOverlayPolicy';
import { buildPetCompanionActivityState } from '@/components/pets/state/buildPetCompanionActivityState';
import { usePetCompanionActivityState } from '@/components/pets/state/usePetCompanionActivityState';
import { useFeatureEnabled } from '@/hooks/server/useFeatureEnabled';
import { useLocalSettings, useSettings } from '@/sync/domains/state/storage';
import { isTauriDesktop } from '@/utils/platform/tauri';

function shouldShowDesktopPetOverlay(params: Readonly<{
    policy: ReturnType<typeof resolveDesktopPetOverlayPolicy>;
    activity: ReturnType<typeof buildPetCompanionActivityState>;
}>): boolean {
    if (!params.policy.enabled) return false;
    if (params.policy.visibilityMode === 'alwaysWhenEnabled') return true;
    if (params.policy.visibilityMode === 'attentionOnly') {
        return params.activity.state === 'waiting' || params.activity.state === 'failed' || params.activity.state === 'review';
    }
    return params.activity.state !== 'idle' || params.activity.sessionId !== null;
}

export function DesktopPetOverlayRuntimeMount(): React.ReactElement | null {
    if (Platform.OS !== 'web' || !isTauriDesktop() || isDesktopPetOverlayWindowContext()) {
        return null;
    }

    return <TauriDesktopPetOverlayRuntimeMount />;
}

function TauriDesktopPetOverlayRuntimeMount(): React.ReactElement {
    const settings = useSettings();
    const localSettings = useLocalSettings();
    const companionEnabled = useFeatureEnabled('pets.companion');
    const activity = usePetCompanionActivityState();
    const policy = React.useMemo(() => resolveDesktopPetOverlayPolicy({
        companionFeatureState: companionEnabled ? 'enabled' : 'disabled',
        accountSettings: settings,
        localSettings,
    }), [companionEnabled, localSettings, settings]);
    const visible = shouldShowDesktopPetOverlay({ policy, activity });
    const expanded = activity.trayItems.length > 0;
    const geometry = React.useMemo(
        () => resolveDesktopPetOverlayGeometry(localSettings.petsCompanionSizeScale),
        [localSettings.petsCompanionSizeScale],
    );
    const window = expanded
        ? {
            width: geometry.expandedWindowWidth,
            height: geometry.expandedWindowHeight,
        }
        : {
            width: geometry.windowWidth,
            height: geometry.windowHeight,
        };

    return (
        <DesktopPetOverlayRuntime
            visible={visible}
            expanded={expanded}
            window={window}
            policy={policy}
        />
    );
}
