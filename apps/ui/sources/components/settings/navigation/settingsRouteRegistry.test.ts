import { describe, expect, it } from 'vitest';

import { getSettingsStackScreenDefinitions } from './settingsRouteRegistry';

describe('settingsRouteRegistry', () => {
    it('registers the actions detail route chrome', () => {
        const definitions = getSettingsStackScreenDefinitions((key) => key);
        const routeNames = definitions.map((definition) => definition.name);

        expect(routeNames).toContain('actions/[actionId]');
    });
});
