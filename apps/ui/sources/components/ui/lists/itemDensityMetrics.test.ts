import { afterEach, describe, expect, it, vi } from 'vitest';

async function importItemDensityMetricsForPlatform(os: 'ios' | 'web') {
    vi.resetModules();
    vi.doMock('react-native', () => ({
        Platform: {
            OS: os,
            select: (value: Record<string, unknown>) => value[os] ?? value.default ?? undefined,
        },
    }));

    return await import('./itemDensityMetrics');
}

afterEach(() => {
    vi.doUnmock('react-native');
    vi.resetModules();
});

describe('itemDensityMetrics', () => {
    it('reserves extra room around comfortable iOS item icons', async () => {
        const { ITEM_ICON_BOX_SIZE } = await importItemDensityMetricsForPlatform('ios');

        expect(ITEM_ICON_BOX_SIZE.comfortable).toBeGreaterThan(29);
    });

    it('keeps the web comfortable icon box unchanged', async () => {
        const { ITEM_ICON_BOX_SIZE } = await importItemDensityMetricsForPlatform('web');

        expect(ITEM_ICON_BOX_SIZE.comfortable).toBe(32);
    });
});
