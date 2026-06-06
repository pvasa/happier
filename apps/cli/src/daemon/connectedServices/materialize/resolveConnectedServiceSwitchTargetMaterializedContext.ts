import type { ConnectedServiceMaterializationIdentityV1 } from '@happier-dev/protocol';

import type { CatalogAgentId } from '@/backends/types';
import { HAPPIER_CONNECTED_SERVICE_TARGET_MATERIALIZED_ROOT_ENV_KEY } from '../connectedServiceChildEnvironment';
import { resolveConnectedServiceMaterializedRootDir } from './resolveConnectedServiceMaterializedRootDir';
import { resolveConnectedServiceTargetMaterializedRoot } from './resolveConnectedServiceTargetMaterializedRoot';

/**
 * Resolve the target materialized env + root the auth-switch continuity gate must prove against.
 *
 * The continuity gate proves resume reachability against the materialized home the NEXT spawn will
 * read. That home is NOT present in the inherited env in two cases, both of which must reconstruct
 * the DETERMINISTIC root from the materialization identity (the exact
 * `<baseDir>/<identity>/<agentId>` layout the spawn will materialize into):
 *   - an INACTIVE switch (no inherited env at all), and
 *   - a TRACKED NATIVE session being switched to connected — an inherited env that carries no
 *     materialized-root key, because native sessions run against `~/.<vendor>` directly.
 *
 * The second case is the bug this fixes: previously the root was reconstructed only for inactive
 * switches (`!tracked`), so a tracked native→connected switch got a null target root and the
 * shared-state continuity gate fail-closed (`provider_session_state_unavailable_for_resume`) BEFORE
 * it could prove the source session — even though the native session file is present and reachable.
 *
 * Reconstruction is a pure path computation with no filesystem side effects; the spawn path still
 * performs the hard post-materialization `targetStrict` re-verify, so fail-closed semantics are
 * preserved. Provider-agnostic: `agentId` is a typed value, no provider branching.
 */
export function resolveConnectedServiceSwitchTargetMaterializedContext(input: Readonly<{
  agentId: CatalogAgentId;
  baseDir: string;
  inheritedEnv: Readonly<Record<string, string>> | null;
  effectiveIdentity: ConnectedServiceMaterializationIdentityV1 | null;
}>): Readonly<{
  targetMaterializedEnv: Readonly<Record<string, string>> | null;
  targetMaterializedRoot: string | null;
}> {
  const inheritedEnv = input.inheritedEnv ?? null;
  const inheritedRoot = resolveConnectedServiceTargetMaterializedRoot({
    agentId: input.agentId,
    targetMaterializedEnv: inheritedEnv,
  });
  const reconstructedRoot = input.effectiveIdentity
    ? resolveConnectedServiceMaterializedRootDir({
        baseDir: input.baseDir,
        agentId: input.agentId,
        materializationKey: input.effectiveIdentity.id,
        materializationIdentity: input.effectiveIdentity,
      })
    : null;

  // Keep the inherited env untouched when it already yields a root (a tracked CONNECTED session) or
  // when there is no identity to reconstruct from (no safe target → caller fails closed). Otherwise
  // inject the reconstructed root so a tracked native→connected (or inactive) switch has the target
  // the next spawn will materialize into.
  const targetMaterializedEnv = inheritedRoot || !reconstructedRoot
    ? inheritedEnv
    : {
        ...(inheritedEnv ?? {}),
        [HAPPIER_CONNECTED_SERVICE_TARGET_MATERIALIZED_ROOT_ENV_KEY]: reconstructedRoot,
      };

  return {
    targetMaterializedEnv,
    targetMaterializedRoot: resolveConnectedServiceTargetMaterializedRoot({
      agentId: input.agentId,
      targetMaterializedEnv,
    }),
  };
}
