import { describe, expect, it } from 'vitest';

import { resolveThemeProfile } from './resolveThemeProfile';
import { createThemeProfileDraft, resetThemeProfileDraftToken } from './createThemeProfileDraft';
import { BUILT_IN_THEME_PROFILES, getBuiltInThemeProfileDefinition } from './builtInThemeProfiles';

const importedDarkThemePresetIds = [
    'catppuccinMocha',
    'catppuccinMacchiato',
    'catppuccinFrappe',
    'oneDarkPro',
    'monokaiPro',
    'githubDark',
    'darkModern',
] as const;

const sunsetDarkSeed = {
    'background.canvas': '#131111',
    'surface.base': '#191717',
    'surface.inset': '#171515',
    'surface.elevated': '#221C1C',
    'surface.selected': '#292121',
    'surface.pressed': '#302727',
    'border.surface': 'rgba(255,255,255,0.056)',
    'border.strong': 'rgba(255,255,255,0.090)',
    'effect.surfaceHighlight': 'transparent',
    'text.primary': '#EFEFEF',
    'text.secondary': '#8A817C',
    'text.tertiary': '#6C625D',
    'text.link': '#D8B45A',
    'text.destructive': '#D06A49',
    'text.placeholder': '#766C67',
    'text.disabled': '#635955',
    'state.active.background': 'rgba(208,106,73,0.11)',
    'state.active.border': 'rgba(208,106,73,0.26)',
    'state.active.foreground': '#D06A49',
    'state.success.foreground': '#7FA98D',
    'state.success.background': 'rgba(127,169,141,0.10)',
    'state.success.border': 'rgba(127,169,141,0.22)',
    'state.warning.foreground': '#E0B65A',
    'state.warning.background': 'rgba(224,182,90,0.10)',
    'state.warning.border': 'rgba(224,182,90,0.22)',
    'state.danger.foreground': '#D06A49',
    'state.danger.background': 'rgba(208,106,73,0.10)',
    'state.danger.border': 'rgba(208,106,73,0.22)',
    'state.info.foreground': '#D8B45A',
    'state.info.background': 'rgba(216,180,90,0.08)',
    'state.info.border': 'rgba(216,180,90,0.20)',
    'control.input.background': '#171515',
    'control.button.primary.background': '#221C1C',
    'control.button.primary.foreground': '#EFEFEF',
    'control.button.primary.disabled': '#2A2323',
    'control.fab.background': '#221C1C',
    'control.fab.backgroundPressed': '#2A2323',
    'control.fab.foreground': '#EFEFEF',
    'control.segmentedControl.trackBackground': '#201A1A',
    'control.segmentedControl.activeBackground': '#2A2222',
    'control.switch.track.active': '#D06A49',
    'control.switch.track.inactive': '#252121',
    'control.switch.thumb.inactive': '#766C67',
    'control.radio.active': '#E0B65A',
    'control.radio.inactive': '#766C67',
    'control.permissionButton.allowAll.background': 'rgba(216,180,90,0.14)',
    'control.permissionButton.allowAll.foreground': '#D8B45A',
    'control.permissionButton.inactive.background': '#131111',
    'control.permissionButton.inactive.border': 'rgba(255,255,255,0.050)',
    'control.permissionButton.inactive.foreground': '#8A817C',
    'control.permissionButton.selected.background': '#2A2222',
    'control.permissionButton.selected.border': 'rgba(255,255,255,0.090)',
    'message.user.background': '#221C1C',
    'message.event.foreground': '#8A817C',
    'syntax.keyword': '#D06A49',
    'syntax.string': '#7FA98D',
    'syntax.comment': '#6C625D',
    'syntax.number': '#E0B65A',
    'syntax.function': '#E9A06C',
    'overlay.scrim': 'rgba(19,17,17,0.72)',
};

const premiumDarkSeed = {
    'background.canvas': '#050506',
    'surface.base': '#141417',
    'surface.inset': '#0D0D10',
    'surface.elevated': '#1B1B20',
    'surface.selected': '#26262D',
    'surface.pressed': '#2D2D35',
    'border.surface': 'rgba(255,255,255,0.075)',
    'border.strong': 'rgba(255,255,255,0.13)',
    'effect.surfaceHighlight': 'transparent',
    'text.primary': '#ECECEF',
    'text.secondary': '#9A9AA3',
    'text.tertiary': '#6F6F78',
    'state.active.background': 'rgba(78,116,190,0.18)',
    'state.active.border': 'rgba(100,145,230,0.45)',
    'state.active.foreground': '#DDE8FF',
    'state.success.foreground': '#70D98A',
    'state.warning.foreground': '#E6B84A',
    'state.danger.foreground': '#E87878',
    'state.info.foreground': '#82A8FF',
    'control.input.background': '#17171C',
    'control.button.primary.background': '#24242B',
    'control.button.primary.foreground': '#ECECEF',
    'control.fab.background': '#24242B',
    'control.fab.foreground': '#ECECEF',
    'syntax.keyword': '#82A8FF',
};

const premiumLightSeed = {
    'background.canvas': '#F6F6F4',
    'surface.base': '#FFFFFF',
    'surface.inset': '#F2F2F0',
    'surface.elevated': '#FCFCFC',
    'border.surface': 'rgba(0,0,0,0.08)',
    'border.strong': 'rgba(0,0,0,0.14)',
    'effect.surfaceHighlight': 'transparent',
    'text.primary': '#111114',
    'text.secondary': '#5A5A5F',
    'text.tertiary': '#7A7A80',
    'state.active.background': 'rgba(10,132,255,0.08)',
    'state.active.border': 'rgba(10,132,255,0.40)',
    'state.active.foreground': '#111114',
    'state.success.foreground': '#248A3D',
    'state.warning.foreground': '#B26A00',
    'state.danger.foreground': '#D70015',
    'state.info.foreground': '#0A84FF',
};

const nightDarkSeed = {
    'background.canvas': '#020204',
    'surface.base': '#090A0E',
    'surface.inset': '#050609',
    'surface.elevated': '#101116',
    'surface.selected': '#141620',
    'surface.pressed': '#191C28',
    'border.surface': 'rgba(255,255,255,0.055)',
    'border.strong': 'rgba(255,255,255,0.095)',
    'effect.surfaceHighlight': 'rgba(255,255,255,0.028)',
    'text.primary': '#E4E3E8',
    'text.secondary': '#898892',
    'text.tertiary': '#5D5C66',
    'state.active.background': 'rgba(225,151,63,0.10)',
    'state.active.border': 'rgba(225,177,90,0.26)',
    'state.active.foreground': '#E8C46F',
    'control.input.background': '#0D0E14',
    'control.button.primary.background': '#141620',
    'control.fab.background': '#141620',
    'overlay.scrim': 'rgba(0,0,0,0.72)',
};

const pitchDarkSeed = {
    'background.canvas': '#090909',
    'surface.base': '#131313',
    'surface.inset': '#1B1B1B',
    'surface.elevated': '#202020',
    'surface.selected': '#1A1A1A',
    'surface.pressed': '#202020',
    'surface.pressedOverlay': 'rgba(255,255,255,0.035)',
    'surface.ripple': 'rgba(255,255,255,0.055)',
    'border.surface': 'rgba(255,255,255,0.05)',
    'border.strong': 'rgba(255,255,255,0.075)',
    'effect.surfaceHighlight': 'transparent',
    'chrome.header.background': '#131313',
    'chrome.header.foreground': '#E8E8E8',
    'text.primary': '#E8E8E8',
    'text.secondary': '#939393',
    'text.tertiary': '#6E6E6E',
    'text.link': '#70CFF8',
    'text.destructive': '#F98181',
    'text.placeholder': '#6A6A6A',
    'text.disabled': '#575757',
    'state.active.background': 'rgba(112,207,248,0.10)',
    'state.active.border': 'rgba(112,207,248,0.24)',
    'state.active.foreground': '#70CFF8',
    'state.success.foreground': '#B9F18D',
    'state.success.background': 'rgba(185,241,141,0.10)',
    'state.success.border': 'rgba(185,241,141,0.22)',
    'state.warning.foreground': '#FBBE88',
    'state.warning.background': 'rgba(251,190,136,0.10)',
    'state.warning.border': 'rgba(251,190,136,0.22)',
    'state.danger.foreground': '#F98181',
    'state.danger.background': 'rgba(249,129,129,0.10)',
    'state.danger.border': 'rgba(249,129,129,0.22)',
    'state.info.foreground': '#70CFF8',
    'state.info.background': 'rgba(112,207,248,0.08)',
    'state.info.border': 'rgba(112,207,248,0.20)',
    'control.input.background': '#131313',
    'control.button.primary.background': '#1B1B1B',
    'control.button.primary.foreground': '#E8E8E8',
    'control.button.primary.disabled': '#232323',
    'control.fab.background': '#1B1B1B',
    'control.fab.backgroundPressed': '#202020',
    'control.fab.foreground': '#E8E8E8',
    'control.segmentedControl.trackBackground': '#131313',
    'control.segmentedControl.activeBackground': '#1A1A1A',
    'control.switch.track.active': '#70CFF8',
    'control.switch.track.inactive': '#202020',
    'control.switch.thumb.inactive': '#939393',
    'control.radio.active': '#70CFF8',
    'control.radio.inactive': '#6E6E6E',
    'control.permissionButton.allowAll.background': 'rgba(112,207,248,0.14)',
    'control.permissionButton.allowAll.foreground': '#70CFF8',
    'control.permissionButton.inactive.background': '#131313',
    'control.permissionButton.inactive.border': 'rgba(255,255,255,0.05)',
    'control.permissionButton.inactive.foreground': '#939393',
    'control.permissionButton.selected.background': '#1A1A1A',
    'control.permissionButton.selected.border': 'rgba(255,255,255,0.075)',
    'message.user.background': '#1A1A1A',
    'message.event.foreground': '#939393',
    'syntax.keyword': '#70CFF8',
    'syntax.string': '#B9F18D',
    'syntax.comment': '#6E6E6E',
    'syntax.number': '#FBBE88',
    'syntax.function': '#C0A7FF',
    'overlay.scrim': 'rgba(9,9,9,0.74)',
};

describe('built-in theme profiles', () => {
    it('exposes curated themes as read-only cloneable presets with locked seed palettes', () => {
        expect(BUILT_IN_THEME_PROFILES.map((definition) => definition.presetId)).toEqual([
            'premiumDark',
            'pitchDark',
            'sunsetDark',
            'nightDark',
            'catppuccinMocha',
            'catppuccinMacchiato',
            'catppuccinFrappe',
            'oneDarkPro',
            'monokaiPro',
            'githubDark',
            'darkModern',
            'premiumLight',
            'catppuccinLatte',
            'githubLight',
        ]);
        expect(getBuiltInThemeProfileDefinition('premiumDark')).toMatchObject({ cloneable: true, editable: false, deletable: false, preferredMode: 'dark' });
        expect(getBuiltInThemeProfileDefinition('premiumLight')).toMatchObject({ cloneable: true, editable: false, deletable: false, preferredMode: 'light' });
        expect(getBuiltInThemeProfileDefinition('nightDark')).toMatchObject({ cloneable: true, editable: false, deletable: false, preferredMode: 'dark' });
        expect(getBuiltInThemeProfileDefinition('sunsetDark')).toMatchObject({ cloneable: true, editable: false, deletable: false, preferredMode: 'dark' });
        expect(getBuiltInThemeProfileDefinition('catppuccinLatte')).toMatchObject({ cloneable: true, editable: false, deletable: false, preferredMode: 'light' });
        expect(getBuiltInThemeProfileDefinition('catppuccinFrappe')).toMatchObject({ cloneable: true, editable: false, deletable: false, preferredMode: 'dark' });
        expect(getBuiltInThemeProfileDefinition('catppuccinMacchiato')).toMatchObject({ cloneable: true, editable: false, deletable: false, preferredMode: 'dark' });
        expect(getBuiltInThemeProfileDefinition('catppuccinMocha')).toMatchObject({ cloneable: true, editable: false, deletable: false, preferredMode: 'dark' });
        expect(getBuiltInThemeProfileDefinition('oneDarkPro')).toMatchObject({ cloneable: true, editable: false, deletable: false, preferredMode: 'dark' });
        expect(getBuiltInThemeProfileDefinition('monokaiPro')).toMatchObject({ cloneable: true, editable: false, deletable: false, preferredMode: 'dark' });
        expect(getBuiltInThemeProfileDefinition('githubDark')).toMatchObject({ cloneable: true, editable: false, deletable: false, preferredMode: 'dark' });
        expect(getBuiltInThemeProfileDefinition('githubLight')).toMatchObject({ cloneable: true, editable: false, deletable: false, preferredMode: 'light' });
        expect(getBuiltInThemeProfileDefinition('darkModern')).toMatchObject({ cloneable: true, editable: false, deletable: false, preferredMode: 'dark' });
        expect(getBuiltInThemeProfileDefinition('premiumDark')?.profile.overrides.dark).toMatchObject(premiumDarkSeed);
        expect(Object.keys(getBuiltInThemeProfileDefinition('premiumDark')?.profile.overrides.dark ?? {}).length).toBeGreaterThan(80);
        expect(BUILT_IN_THEME_PROFILES.find((definition) => definition.presetId === 'pitchDark')?.profile.overrides.dark).toMatchObject(pitchDarkSeed);
        expect(Object.keys(BUILT_IN_THEME_PROFILES.find((definition) => definition.presetId === 'pitchDark')?.profile.overrides.dark ?? {}).length).toBeGreaterThan(20);
        expect(BUILT_IN_THEME_PROFILES.find((definition) => definition.presetId === 'sunsetDark')?.profile.overrides.dark).toMatchObject(sunsetDarkSeed);
        expect(Object.keys(BUILT_IN_THEME_PROFILES.find((definition) => definition.presetId === 'sunsetDark')?.profile.overrides.dark ?? {}).length).toBeGreaterThan(20);
        expect(getBuiltInThemeProfileDefinition('premiumLight')?.profile.overrides.light).toEqual(premiumLightSeed);
        expect(getBuiltInThemeProfileDefinition('nightDark')?.profile.overrides.dark).toMatchObject(nightDarkSeed);
        expect(Object.keys(getBuiltInThemeProfileDefinition('nightDark')?.profile.overrides.dark ?? {}).length).toBeGreaterThan(80);
        expect(getBuiltInThemeProfileDefinition('nightDark')?.profile.overrides.dark['effect.surfaceHighlight']).toBe('rgba(255,255,255,0.028)');
        for (const presetId of importedDarkThemePresetIds) {
            expect(getBuiltInThemeProfileDefinition(presetId)?.profile.overrides.dark['effect.surfaceHighlight']).toBe('transparent');
        }
        expect(getBuiltInThemeProfileDefinition('catppuccinMocha')?.profile.overrides.dark).toMatchObject({
            'background.canvas': '#11111B',
            'surface.base': '#1E1E2E',
            'text.primary': '#CDD6F4',
            'text.secondary': '#BAC2DE',
            'state.active.foreground': '#89B4FA',
            'syntax.keyword': '#CBA6F7',
        });
        expect(getBuiltInThemeProfileDefinition('catppuccinLatte')?.profile.overrides.light).toMatchObject({
            'background.canvas': '#EFF1F5',
            'surface.base': '#FFFFFF',
            'text.primary': '#4C4F69',
            'text.secondary': '#5C5F77',
            'state.active.foreground': '#1E66F5',
            'syntax.keyword': '#8839EF',
        });
        expect(getBuiltInThemeProfileDefinition('oneDarkPro')?.profile.overrides.dark).toMatchObject({
            'background.canvas': '#21252B',
            'surface.base': '#282C34',
            'text.primary': '#ABB2BF',
            'state.active.foreground': '#61AFEF',
            'syntax.keyword': '#C678DD',
        });
        expect(getBuiltInThemeProfileDefinition('monokaiPro')?.profile.overrides.dark).toMatchObject({
            'background.canvas': '#221F22',
            'surface.base': '#2D2A2E',
            'text.primary': '#FCFCFA',
            'state.active.foreground': '#FFD866',
            'syntax.keyword': '#FF6188',
        });
        expect(getBuiltInThemeProfileDefinition('githubDark')?.profile.overrides.dark).toMatchObject({
            'background.canvas': '#0D1117',
            'surface.base': '#161B22',
            'text.primary': '#E6EDF3',
            'state.active.foreground': '#2F81F7',
            'syntax.keyword': '#FF7B72',
        });
        expect(getBuiltInThemeProfileDefinition('githubLight')?.profile.overrides.light).toMatchObject({
            'background.canvas': '#FFFFFF',
            'surface.base': '#F6F8FA',
            'text.primary': '#1F2328',
            'state.active.foreground': '#0969DA',
            'syntax.keyword': '#CF222E',
        });
        expect(getBuiltInThemeProfileDefinition('darkModern')?.profile.overrides.dark).toMatchObject({
            'background.canvas': '#181818',
            'surface.base': '#1F1F1F',
            'text.primary': '#CCCCCC',
            'state.active.foreground': '#0078D4',
            'syntax.keyword': '#569CD6',
        });
    });

    it('clones a built-in profile into an editable flat custom profile', () => {
        const builtIn = getBuiltInThemeProfileDefinition('premiumDark')?.profile;
        if (!builtIn) throw new Error('missing premium dark');

        const clone = createThemeProfileDraft({ id: 'clone', name: 'My Crisp Dark', now: '2026-05-11T00:00:00.000Z', sourceProfile: builtIn });

        expect(clone.id).toBe('clone');
        expect(clone.overrides).toEqual(builtIn.overrides);
        expect(clone.overrides).not.toBe(builtIn.overrides);
    });

    it('resolves internal feed card surfaces from each built-in preset palette', () => {
        for (const definition of BUILT_IN_THEME_PROFILES) {
            const effective = resolveThemeProfile({
                mode: definition.preferredMode,
                profile: definition.profile,
            });

            expect(effective.colors.feed.card.background).toBe(effective.colors.surface.elevated);
        }
    });

    it('resets a token in a built-in clone back to canonical base, not the preset value', () => {
        const builtIn = getBuiltInThemeProfileDefinition('premiumDark')?.profile;
        if (!builtIn) throw new Error('missing premium dark');
        const clone = createThemeProfileDraft({ id: 'clone', name: 'My Crisp Dark', now: '2026-05-11T00:00:00.000Z', sourceProfile: builtIn });
        const reset = resetThemeProfileDraftToken(clone, 'dark', 'background.canvas', '2026-05-11T00:01:00.000Z');

        expect(resolveThemeProfile({ mode: 'dark', profile: reset }).colors.background.canvas).toBe('#181818');
    });
});
