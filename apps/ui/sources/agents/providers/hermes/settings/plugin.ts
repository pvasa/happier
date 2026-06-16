import { createNoopProviderSettingsPlugin } from '@/agents/providers/shared/createNoopProviderSettingsPlugin';

export const HERMES_PROVIDER_SETTINGS_PLUGIN = createNoopProviderSettingsPlugin({
    providerId: 'hermes',
    title: { key: 'settingsProviders.plugins.hermes.title' },
    icon: { ionName: 'paper-plane-outline', color: '#0EA5E9' },
});
