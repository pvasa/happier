import { isActionEnabledByActionsSettings, type AccountSettings, type ActionId, type ActionSurfaces } from '@happier-dev/protocol';

import { isActionEnabledByEnv } from '@/settings/actionsSettings';

export function createMcpActionEnablement(params: Readonly<{
  accountSettings?: AccountSettings | null;
  surface: keyof ActionSurfaces;
}>): (id: ActionId) => boolean {
  const actionsSettings = params.accountSettings?.actionsSettingsV1 ?? null;
  if (actionsSettings) {
    return (id) => isActionEnabledByActionsSettings(id, actionsSettings, {
      surface: params.surface,
      placement: null,
    });
  }

  return (id) => isActionEnabledByEnv(id, { surface: params.surface });
}
