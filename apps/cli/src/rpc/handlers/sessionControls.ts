import {
  SessionGoalClearRequestV1Schema,
  SessionGoalGetRequestV1Schema,
  SessionGoalSetRequestV1Schema,
  SessionSkillCatalogListRequestV1Schema,
  SessionVendorPluginCatalogListRequestV1Schema,
  SessionWorkStateGetRequestV1Schema,
  SessionWorkStateV1Schema,
} from '@happier-dev/protocol';
import { SESSION_RPC_METHODS } from '@happier-dev/protocol/rpc';

import type { Metadata } from '@/api/types';
import type { RpcHandlerRegistrar } from '@/api/rpc/types';

export type SessionRuntimeControls = {
  refreshGoal?: () => Promise<void>;
  setGoal?: (
    objective: string,
    options?: Readonly<{
      status?: string;
      tokenBudget?: number | null;
    }>,
  ) => Promise<void>;
  clearGoal?: () => Promise<void>;
  listVendorPlugins?: () => Promise<unknown>;
  listSkills?: () => Promise<unknown>;
};

function unsupported(method: string): Readonly<{ ok: false; errorCode: string; error: string }> {
  return {
    ok: false,
    errorCode: 'unsupported_session_runtime_method',
    error: `unsupported_session_runtime_method:${method}`,
  };
}

function invalidInput(): Readonly<{ ok: false; errorCode: string; error: string }> {
  return { ok: false, errorCode: 'invalid_parameters', error: 'invalid_parameters' };
}

function readWorkState(getSessionMetadata?: (() => Metadata | null) | null): unknown {
  const metadata = getSessionMetadata?.();
  if (!metadata || typeof metadata !== 'object') return null;
  const parsed = SessionWorkStateV1Schema.safeParse((metadata as Record<string, unknown>).sessionWorkStateV1);
  return parsed.success ? parsed.data : null;
}

export function registerSessionControlHandlers(
  rpc: RpcHandlerRegistrar,
  opts: Readonly<{
    getSessionMetadata?: (() => Metadata | null) | null;
    sessionRuntimeControls?: SessionRuntimeControls | null;
  }>,
): void {
  rpc.registerHandler(SESSION_RPC_METHODS.SESSION_WORK_STATE_GET, async (raw: unknown) => {
    const parsed = SessionWorkStateGetRequestV1Schema.safeParse(raw);
    if (!parsed.success) return invalidInput();
    return { workState: readWorkState(opts.getSessionMetadata) };
  });

  rpc.registerHandler(SESSION_RPC_METHODS.SESSION_GOAL_GET, async (raw: unknown) => {
    const parsed = SessionGoalGetRequestV1Schema.safeParse(raw);
    if (!parsed.success) return invalidInput();
    if (typeof opts.sessionRuntimeControls?.refreshGoal !== 'function') {
      return unsupported(SESSION_RPC_METHODS.SESSION_GOAL_GET);
    }
    await opts.sessionRuntimeControls.refreshGoal();
    return { workState: readWorkState(opts.getSessionMetadata) };
  });

  rpc.registerHandler(SESSION_RPC_METHODS.SESSION_GOAL_SET, async (raw: unknown) => {
    const parsed = SessionGoalSetRequestV1Schema.safeParse(raw);
    if (!parsed.success) return invalidInput();
    if (typeof opts.sessionRuntimeControls?.setGoal !== 'function') {
      return unsupported(SESSION_RPC_METHODS.SESSION_GOAL_SET);
    }
    await opts.sessionRuntimeControls.setGoal(parsed.data.objective, {
      ...(parsed.data.status ? { status: parsed.data.status } : {}),
      ...(Object.prototype.hasOwnProperty.call(parsed.data, 'tokenBudget')
        ? { tokenBudget: parsed.data.tokenBudget ?? null }
        : {}),
    });
    return { workState: readWorkState(opts.getSessionMetadata) };
  });

  rpc.registerHandler(SESSION_RPC_METHODS.SESSION_GOAL_CLEAR, async (raw: unknown) => {
    const parsed = SessionGoalClearRequestV1Schema.safeParse(raw);
    if (!parsed.success) return invalidInput();
    if (typeof opts.sessionRuntimeControls?.clearGoal !== 'function') {
      return unsupported(SESSION_RPC_METHODS.SESSION_GOAL_CLEAR);
    }
    await opts.sessionRuntimeControls.clearGoal();
    return { workState: readWorkState(opts.getSessionMetadata) };
  });

  rpc.registerHandler(SESSION_RPC_METHODS.SESSION_VENDOR_PLUGIN_CATALOG_LIST, async (raw: unknown) => {
    const parsed = SessionVendorPluginCatalogListRequestV1Schema.safeParse(raw);
    if (!parsed.success) return invalidInput();
    if (typeof opts.sessionRuntimeControls?.listVendorPlugins !== 'function') {
      return { unsupported: true, vendorPlugins: [] };
    }
    return await opts.sessionRuntimeControls.listVendorPlugins();
  });

  rpc.registerHandler(SESSION_RPC_METHODS.SESSION_SKILL_CATALOG_LIST, async (raw: unknown) => {
    const parsed = SessionSkillCatalogListRequestV1Schema.safeParse(raw);
    if (!parsed.success) return invalidInput();
    if (typeof opts.sessionRuntimeControls?.listSkills !== 'function') {
      return { unsupported: true, skills: [] };
    }
    return await opts.sessionRuntimeControls.listSkills();
  });
}
