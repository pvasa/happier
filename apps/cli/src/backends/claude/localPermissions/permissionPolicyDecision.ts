import type { PermissionMode } from '@/api/types';
import { isDefaultWriteLikeToolName } from '@/agent/permissions/writeLikeToolNameHeuristics';
import { isChangeTitleToolLikeName } from '@happier-dev/protocol/tools/v2';

export type LocalPermissionPolicyDecision = 'prompt' | 'allow' | 'deny';

/**
 * Permission policy for Claude sessions gated through the Happier hook bridge.
 *
 * Claude has a native auto-approval engine, so Happier's "Auto" mode (`safe-yolo`) is a pure
 * pass-through: Claude is launched in `--permission-mode auto` (see `mapToClaudeMode`) and decides for
 * itself what to auto-approve, consulting the user's `~/.claude/settings.json` rules. Claude fires a
 * `PermissionRequest` hook only on a *genuine* escalation — by the time this policy is consulted,
 * Claude has already decided it must ask — so the bridge simply relays that escalation to the Happier
 * UI ('prompt') instead of imposing its own heuristic. `default`/`plan`/legacy modes relay the same
 * way; they differ only in the native Claude mode they map to, which is what actually changes how much
 * Claude escalates.
 *
 * The only modes where Happier still decides locally are the deterministic ones: `yolo` (allow
 * everything) and `read-only` (allow reads, deny writes by tool name).
 */
export function computeLocalPermissionPolicyDecision(params: {
    mode: PermissionMode;
    toolName: string;
}): LocalPermissionPolicyDecision {
    const { mode, toolName } = params;

    if (isChangeTitleToolLikeName(toolName)) return 'allow';
    if (mode === 'yolo') return 'allow';
    if (mode === 'read-only') {
        return isDefaultWriteLikeToolName(toolName) ? 'deny' : 'allow';
    }
    return 'prompt';
}
