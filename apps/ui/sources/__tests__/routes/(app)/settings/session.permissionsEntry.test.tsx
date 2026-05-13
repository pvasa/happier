import * as React from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { renderSettingsView, standardCleanup } from '@/dev/testkit';
import {
    installSessionSettingsEntryModuleMocks,
    resetSessionSettingsEntryState,
    sessionSettingsEntryState,
} from './sessionSettingsEntryTestHelpers';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

installSessionSettingsEntryModuleMocks();

afterEach(() => {
    standardCleanup();
    resetSessionSettingsEntryState();
});

describe('Session settings (Permissions entry)', () => {
    it('does not render a permissions entry or inline permission controls on the root session settings screen', async () => {
        const mod = await import('@/app/(app)/settings/session');
        const SessionSettingsScreen = mod.default;
        const screen = await renderSettingsView(React.createElement(SessionSettingsScreen));

        const titles = screen.findAllByType('Item' as any).map((item) => item.props.title);

        expect(titles).not.toContain('settings.permissions');
        expect(titles).not.toContain('settingsSession.defaultPermissions.applyPermissionChangesTitle');
    });

    it('renders wizard mode as a toggle in the new-session modal group', async () => {
        const mod = await import('@/app/(app)/settings/session');
        const SessionSettingsScreen = mod.default;
        const screen = await renderSettingsView(React.createElement(SessionSettingsScreen));

        expect(screen.findAllByType('DropdownMenu' as any).some((dropdown) =>
            dropdown.props.itemTrigger?.title === 'settingsSession.sessionCreation.modalModeTitle'
        )).toBe(false);
        expect(screen.findRowByTitle('settingsSession.sessionCreation.wizardModeTitle')).toBeTruthy();
        expect(screen.findRowByTitle('settingsSession.sessionCreation.wizardDispositionTitle')).toBeNull();

        screen.pressRowByTitle('settingsSession.sessionCreation.wizardModeTitle');
        expect(sessionSettingsEntryState.settingsState.useEnhancedSessionWizard).toBe(true);
    });

    it('shows the wizard disposition link only when wizard modal mode is selected', async () => {
        sessionSettingsEntryState.settingsState.useEnhancedSessionWizard = true;
        const mod = await import('@/app/(app)/settings/session');
        const SessionSettingsScreen = mod.default;
        const screen = await renderSettingsView(React.createElement(SessionSettingsScreen));

        expect(screen.findRowByTitle('settingsSession.sessionCreation.wizardDispositionTitle')).toBeTruthy();
        screen.pressRowByTitle('settingsSession.sessionCreation.wizardDispositionTitle');
        expect(sessionSettingsEntryState.routerPushSpy).toHaveBeenCalledWith('/settings/session/new-session-wizard');
    });

    it('renders remembered project session selections in the new-session modal group', async () => {
        const mod = await import('@/app/(app)/settings/session');
        const SessionSettingsScreen = mod.default;
        const screen = await renderSettingsView(React.createElement(SessionSettingsScreen));

        const row = screen.findRowByTitle('settingsSession.sessionCreation.rememberLastProjectSelectionsTitle');
        expect(row).toBeTruthy();

        let current = row?.parent;
        let groupTitle: unknown;
        while (current) {
            if ((current.type as unknown) === 'ItemGroup') {
                groupTitle = current.props?.title;
                break;
            }
            current = current.parent;
        }

        expect(groupTitle).toBe('settingsSession.sessionCreation.title');

        screen.pressRowByTitle('settingsSession.sessionCreation.rememberLastProjectSelectionsTitle');
        expect(sessionSettingsEntryState.settingsState.rememberLastProjectSessionSelections).toBe(false);
    });

    it('renders remembered engine selections in the new-session modal group', async () => {
        const mod = await import('@/app/(app)/settings/session');
        const SessionSettingsScreen = mod.default;
        const screen = await renderSettingsView(React.createElement(SessionSettingsScreen));

        const row = screen.findRowByTitle('settingsSession.sessionCreation.rememberLastEngineSelectionsTitle');
        expect(row).toBeTruthy();

        screen.pressRowByTitle('settingsSession.sessionCreation.rememberLastEngineSelectionsTitle');
        expect(sessionSettingsEntryState.settingsState.rememberLastEngineSelectionsV1).toBe(false);
    });

    it('renders animated working status text as a session list setting', async () => {
        const mod = await import('@/app/(app)/settings/session');
        const SessionSettingsScreen = mod.default;
        const screen = await renderSettingsView(React.createElement(SessionSettingsScreen));

        const row = screen.findRowByTitle('settingsSession.sessionList.workingStatusAnimatedTextTitle');
        expect(row).toBeTruthy();

        let current = row?.parent;
        let groupTitle: unknown;
        while (current) {
            if ((current.type as unknown) === 'ItemGroup') {
                groupTitle = current.props?.title;
                break;
            }
            current = current.parent;
        }

        expect(groupTitle).toBe('settingsSession.sessionList.title');

        screen.pressRowByTitle('settingsSession.sessionList.workingStatusAnimatedTextTitle');
        expect(sessionSettingsEntryState.settingsState.sessionListWorkingStatusAnimatedTextEnabled).toBe(false);
    });

    it('renders narrow working indicator style as a session list setting', async () => {
        const mod = await import('@/app/(app)/settings/session');
        const SessionSettingsScreen = mod.default;
        const screen = await renderSettingsView(React.createElement(SessionSettingsScreen));

        const dropdown = screen.findAllByType('DropdownMenu' as any).find((node) =>
            node.props.itemTrigger?.title === 'settingsSession.sessionList.narrowWorkingIndicatorTitle'
        );
        expect(dropdown).toBeTruthy();
        expect(dropdown?.props.selectedId).toBe('spinner');

        dropdown?.props.onSelect('pulse');

        expect(sessionSettingsEntryState.settingsState.sessionListNarrowWorkingIndicatorStyle).toBe('pulse');
    });
});
