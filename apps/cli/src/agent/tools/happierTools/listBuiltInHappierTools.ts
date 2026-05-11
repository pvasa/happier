import { HAPPIER_BUILT_IN_TOOLS } from './catalog';
import { filterBuiltInToolsForSurface } from './actionToolCatalog';
import { isActionEnabledByEnv } from '@/settings/actionsSettings';
import type { ActionId } from '@happier-dev/protocol';

export type BuiltInHappierToolsSurface = 'mcp' | 'cli' | 'session_agent';

export function listBuiltInHappierTools(params?: Readonly<{
  surface?: BuiltInHappierToolsSurface;
  isActionEnabled?: (id: ActionId) => boolean;
}>) {
  const surface = params?.surface ?? 'session_agent';
  const isActionEnabled = params?.isActionEnabled ?? ((id: ActionId) => isActionEnabledByEnv(id, { surface }));
  return [
    ...filterBuiltInToolsForSurface(
      HAPPIER_BUILT_IN_TOOLS,
      { surface, isActionEnabled },
    ),
  ];
}
