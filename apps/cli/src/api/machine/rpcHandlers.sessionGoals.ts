import {
  DaemonSessionGoalClearRequestV1Schema,
  DaemonSessionGoalGetRequestV1Schema,
  DaemonSessionGoalSetRequestV1Schema,
  type ActionExecutorDeps,
} from '@happier-dev/protocol';
import { RPC_METHODS } from '@happier-dev/protocol/rpc';

import { readCredentials, type Credentials } from '@/persistence';
import { createCliActionDeps } from '@/session/actions/createCliActionDeps';
import {
  resolveSessionTransportContext,
  type ResolveSessionTransportContextResult,
} from '@/session/services/resolveSessionTransportContext';

import type { RpcHandlerRegistrar } from '../rpc/types';

type RegisterMachineSessionGoalRpcHandlersDeps = Readonly<{
  readCredentials?: () => Promise<Credentials | null>;
  resolveSessionTransportContext?: typeof resolveSessionTransportContext;
  createCliActionDeps?: (
    params: Parameters<typeof createCliActionDeps>[0],
  ) => Pick<ActionExecutorDeps, 'sessionGoalGet' | 'sessionGoalSet' | 'sessionGoalClear'>;
}>;

type GoalOperation = 'get' | 'set' | 'clear';

function invalidParameters(): Readonly<{ ok: false; errorCode: 'invalid_parameters'; error: 'invalid_parameters' }> {
  return { ok: false, errorCode: 'invalid_parameters', error: 'invalid_parameters' };
}

function notAuthenticated(): Readonly<{ ok: false; errorCode: 'not_authenticated'; error: 'not_authenticated' }> {
  return { ok: false, errorCode: 'not_authenticated', error: 'not_authenticated' };
}

function transportError(transport: Extract<ResolveSessionTransportContextResult, { ok: false }>): Readonly<{
  ok: false;
  errorCode: string;
  error: string;
  candidates?: string[];
  sessionId?: string;
}> {
  return {
    ok: false,
    errorCode: transport.code,
    error: transport.code,
    ...(transport.candidates ? { candidates: transport.candidates } : {}),
    ...(transport.sessionId ? { sessionId: transport.sessionId } : {}),
  };
}

async function executeGoalControl(params: Readonly<{
  operation: GoalOperation;
  raw: unknown;
  deps?: RegisterMachineSessionGoalRpcHandlersDeps;
}>): Promise<unknown> {
  if (params.operation === 'get') {
    const parsed = DaemonSessionGoalGetRequestV1Schema.safeParse(params.raw);
    if (!parsed.success) return invalidParameters();
    return await executeResolvedGoalControl({
      operation: 'get',
      sessionId: parsed.data.sessionId,
      deps: params.deps,
    });
  }
  if (params.operation === 'clear') {
    const parsed = DaemonSessionGoalClearRequestV1Schema.safeParse(params.raw);
    if (!parsed.success) return invalidParameters();
    return await executeResolvedGoalControl({
      operation: 'clear',
      sessionId: parsed.data.sessionId,
      deps: params.deps,
    });
  }
  const parsed = DaemonSessionGoalSetRequestV1Schema.safeParse(params.raw);
  if (!parsed.success) return invalidParameters();
  return await executeResolvedGoalControl({
    operation: 'set',
    sessionId: parsed.data.sessionId,
    request: parsed.data,
    deps: params.deps,
  });
}

async function executeResolvedGoalControl(params: Readonly<{
  operation: GoalOperation;
  sessionId: string;
  request?: Readonly<{
    objective?: string;
    status?: string;
    tokenBudget?: number | null;
  }>;
  deps?: RegisterMachineSessionGoalRpcHandlersDeps;
}>): Promise<unknown> {
  const credentials = await (params.deps?.readCredentials ?? readCredentials)();
  if (!credentials) return notAuthenticated();

  const transport = await (params.deps?.resolveSessionTransportContext ?? resolveSessionTransportContext)({
    credentials,
    idOrPrefix: params.sessionId,
  });
  if (!transport.ok) return transportError(transport);

  const actionDeps = (params.deps?.createCliActionDeps ?? createCliActionDeps)({
    token: credentials.token,
    credentials,
    sessionId: transport.sessionId,
    rawSession: transport.rawSession,
    ctx: transport.ctx,
    mode: transport.mode,
  });

  if (params.operation === 'get') {
    return actionDeps.sessionGoalGet
      ? await actionDeps.sessionGoalGet({ sessionId: transport.sessionId })
      : { ok: false, errorCode: 'action_not_supported', error: 'action_not_supported' };
  }
  if (params.operation === 'clear') {
    return actionDeps.sessionGoalClear
      ? await actionDeps.sessionGoalClear({ sessionId: transport.sessionId })
      : { ok: false, errorCode: 'action_not_supported', error: 'action_not_supported' };
  }

  if (!actionDeps.sessionGoalSet) {
    return { ok: false, errorCode: 'action_not_supported', error: 'action_not_supported' };
  }
  const request = params.request ?? {};
  return await actionDeps.sessionGoalSet({
    sessionId: transport.sessionId,
    ...(typeof request.objective === 'string' ? { objective: request.objective } : {}),
    ...(typeof request.status === 'string' ? { status: request.status } : {}),
    ...(Object.prototype.hasOwnProperty.call(request, 'tokenBudget') ? { tokenBudget: request.tokenBudget } : {}),
  });
}

export function registerMachineSessionGoalRpcHandlers(params: Readonly<{
  rpcHandlerManager: RpcHandlerRegistrar;
  deps?: RegisterMachineSessionGoalRpcHandlersDeps;
}>): void {
  params.rpcHandlerManager.registerHandler(RPC_METHODS.DAEMON_SESSION_GOAL_GET, async (raw: unknown) => (
    await executeGoalControl({ operation: 'get', raw, deps: params.deps })
  ));
  params.rpcHandlerManager.registerHandler(RPC_METHODS.DAEMON_SESSION_GOAL_SET, async (raw: unknown) => (
    await executeGoalControl({ operation: 'set', raw, deps: params.deps })
  ));
  params.rpcHandlerManager.registerHandler(RPC_METHODS.DAEMON_SESSION_GOAL_CLEAR, async (raw: unknown) => (
    await executeGoalControl({ operation: 'clear', raw, deps: params.deps })
  ));
}
