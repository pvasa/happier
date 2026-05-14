import { describe, expect, it, vi } from 'vitest';

vi.mock('@/sync/domains/input/suggestionFile', () => ({
    searchFiles: vi.fn(async () => []),
}));

vi.mock('@/sync/domains/input/suggestionCommands', () => ({
    searchCommands: vi.fn(async () => [
        { command: 'goal', description: 'Set or inspect the session goal' },
    ]),
}));

describe('structured input autocomplete suggestions', () => {
    it('uses a taller row height for slash commands with descriptions', async () => {
        const { getCommandSuggestions } = await import('./suggestions');

        const suggestions = await getCommandSuggestions('s1', '/go');

        expect(suggestions[0]).toMatchObject({
            key: 'cmd-goal',
            text: '/goal',
            label: '/goal',
            description: 'Set or inspect the session goal',
            rowHeight: 52,
        });
    });

    it('returns vendor plugin suggestions from explicit plugin namespace queries', async () => {
        const { getSuggestions } = await import('./suggestions');

        const suggestions = await getSuggestions('s1', '@plugin:gmail', {
            vendorPlugins: [
                {
                    name: 'gmail',
                    displayName: 'Gmail',
                    description: 'Mail and calendar',
                    vendorPluginRef: 'plugin://gmail@openai-curated',
                    marketplace: 'openai-curated',
                    installed: true,
                    enabled: true,
                },
            ],
        } as never);

        expect(suggestions).toHaveLength(1);
        expect(suggestions[0]).toMatchObject({
            key: 'vendor-plugin-plugin://gmail@openai-curated',
            text: '@gmail',
            structuredInput: {
                kind: 'vendorPlugin',
                vendorPluginRef: 'plugin://gmail@openai-curated',
            },
        });
    });

    it('keeps path-like at queries file-first', async () => {
        const { getSuggestions } = await import('./suggestions');

        const suggestions = await getSuggestions('s1', '@/src', {
            files: [
                {
                    fileName: 'index.ts',
                    filePath: 'src/',
                    fullPath: 'src/index.ts',
                    fileType: 'file',
                },
            ],
            vendorPlugins: [
                {
                    name: 'src',
                    displayName: 'Source Plugin',
                    vendorPluginRef: 'plugin://src@openai-curated',
                    installed: true,
                    enabled: true,
                },
            ],
        } as never);

        expect(suggestions).toHaveLength(1);
        expect(suggestions[0]).toMatchObject({
            key: 'file-src/index.ts',
            text: '@src/index.ts',
        });
        expect(suggestions[0]?.structuredInput).toBeUndefined();
    });

    it('returns skill suggestions for dollar queries', async () => {
        const { getSuggestions } = await import('./suggestions');

        const suggestions = await getSuggestions('s1', '$rev', {
            skills: [
                {
                    name: 'review',
                    displayName: 'Review',
                    description: 'Review code',
                    path: '/skills/review/SKILL.md',
                    enabled: true,
                    projectionKind: 'codex_native',
                },
            ],
        } as never);

        expect(suggestions).toHaveLength(1);
        expect(suggestions[0]).toMatchObject({
            key: 'skill-review',
            text: '$review',
            structuredInput: {
                kind: 'skill',
                name: 'review',
                path: '/skills/review/SKILL.md',
            },
        });
    });
});
