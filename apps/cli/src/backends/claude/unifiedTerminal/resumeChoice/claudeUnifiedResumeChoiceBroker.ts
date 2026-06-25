import { randomUUID } from 'node:crypto';

import { AgentStateRequestStore, type AgentStateOutstandingRequest } from '@/agent/permissions/agentStateRequestStore';
import {
  createPermissionRequestCoordinator,
  type PermissionRequestCoordinator,
  type PermissionRequestCoordinatorContext,
  type PermissionRequestCoordinatorStore,
} from '@/agent/permissions/permissionRequestCoordinator';
import {
  CLAUDE_UNIFIED_TERMINAL_RESUME_CHOICE_REQUEST_SOURCE,
  isClaudeUnifiedTerminalResumeChoiceAgentStateRequest,
} from '@happier-dev/agents';

import type { Session } from '../../session';
import type { PermissionRpcPayload } from '../../utils/permissionRpc';
import type { PermissionRpcConsumerOutcome } from '../../utils/permissionRpcRouter';
import type { ClaudeUnifiedResumeChoiceAnswer } from '../tuiControls/resumeChoice';

export const CLAUDE_UNIFIED_RESUME_CHOICE_QUESTION = 'How should Claude resume this session?' as const;

const REQUEST_TOOL_NAME = 'AskUserQuestion';
const REQUEST_ID_PREFIX = 'claude_resume_choice_';

type PendingChoice = Readonly<{
  requestId: string;
  promise: Promise<ClaudeUnifiedResumeChoiceAnswer>;
}>;

function createResumeChoiceToolInput(): unknown {
  return {
    questions: [
      {
        header: 'Claude resume',
        question: CLAUDE_UNIFIED_RESUME_CHOICE_QUESTION,
        multiSelect: false,
        options: [
          {
            label: 'Resume from summary',
            description: 'Use Claude\'s saved summary so this large session resumes faster.',
          },
          {
            label: 'Resume full session',
            description: 'Load the full session context before continuing.',
          },
        ],
      },
    ],
  };
}

function decodeResumeChoice(payload: PermissionRpcPayload): ClaudeUnifiedResumeChoiceAnswer | null {
  if (payload.approved !== true) return null;
  const answers = payload.answers;
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) return null;
  const raw = (answers as Record<string, unknown>)[CLAUDE_UNIFIED_RESUME_CHOICE_QUESTION];
  if (raw === 'Resume from summary' || raw === 'resume_from_summary') return 'resume_from_summary';
  if (raw === 'Resume full session' || raw === 'resume_full_session') return 'resume_full_session';
  return null;
}

function isResumeChoiceContext(context: PermissionRequestCoordinatorContext | null): context is PermissionRequestCoordinatorContext {
  return context?.source === CLAUDE_UNIFIED_TERMINAL_RESUME_CHOICE_REQUEST_SOURCE;
}

export class ClaudeUnifiedResumeChoiceBroker {
  private readonly session: Session;
  private readonly requestStore: AgentStateRequestStore;
  private readonly permissionCoordinator: PermissionRequestCoordinator<ClaudeUnifiedResumeChoiceAnswer>;
  private readonly createRequestId: () => string;
  private readonly nowMs: () => number;
  private pendingChoice: PendingChoice | null = null;
  private activated = false;
  private disposed = false;

  constructor(session: Session, opts?: Readonly<{
    createRequestId?: (() => string) | undefined;
    nowMs?: (() => number) | undefined;
  }>) {
    this.session = session;
    this.createRequestId = opts?.createRequestId ?? (() => `${REQUEST_ID_PREFIX}${randomUUID()}`);
    this.nowMs = opts?.nowMs ?? Date.now;
    this.requestStore = new AgentStateRequestStore({
      session: session.client,
      logPrefix: '[claude-unified-resume-choice]',
      pushSender: session.pushSender,
      getAccountSettings: () => session.accountSettings ?? null,
      getAccountSettingsSecretsReadKeys: () => session.accountSettingsSecretsReadKeys,
    });
    this.permissionCoordinator = createPermissionRequestCoordinator<ClaudeUnifiedResumeChoiceAnswer>({
      store: this.createCoordinatorStore(),
    });
  }

  activate(): void {
    if (this.activated) return;
    this.activated = true;
    this.session.getOrCreatePermissionRpcRouter().registerConsumer({
      name: 'claude-unified-resume-choice',
      tryHandlePermissionRpc: (payload) => this.tryHandlePermissionRpc(payload),
    });
  }

  hasPendingChoice(): boolean {
    return this.pendingChoice !== null;
  }

  requestResumeChoice(params?: Readonly<{ signal?: AbortSignal | undefined }>): Promise<ClaudeUnifiedResumeChoiceAnswer> {
    if (this.disposed) {
      return Promise.reject(new Error('claude_unified_resume_choice_broker_disposed'));
    }
    if (this.pendingChoice) return this.pendingChoice.promise;

    const requestId = this.createRequestId();
    const toolInput = createResumeChoiceToolInput();
    const promise = this.permissionCoordinator.requestDecision({
      requestId,
      toolName: REQUEST_TOOL_NAME,
      toolInput,
      createdAt: this.nowMs(),
      kind: 'user_action',
      source: CLAUDE_UNIFIED_TERMINAL_RESUME_CHOICE_REQUEST_SOURCE,
    }, {
      signal: params?.signal,
    }).finally(() => {
      if (this.pendingChoice?.requestId === requestId) {
        this.pendingChoice = null;
      }
    });

    this.pendingChoice = { requestId, promise };
    return promise;
  }

  cancelPendingChoice(reason: string): void {
    const requestId = this.pendingChoice?.requestId;
    if (!requestId) return;
    this.completeSourceOwnedCancellation(requestId, reason);
  }

  noteDialogResolvedInTerminal(reason: string): void {
    this.cancelPendingChoice(reason);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelAllSourceOwnedRequests('claude_unified_resume_choice_broker_disposed');
    this.permissionCoordinator.dispose();
  }

  private createCoordinatorStore(): PermissionRequestCoordinatorStore {
    return {
      publishRequest: (params) => this.requestStore.publishRequest({
        ...params,
        updateState: (state) => ({
          ...state,
          capabilities: {
            ...(state.capabilities && typeof state.capabilities === 'object' ? state.capabilities : {}),
            askUserQuestionAnswersInPermission: true,
          },
        }),
      }),
      completeRequest: (params) => this.requestStore.completeRequest(params),
      cancelAllRequests: (params) => this.cancelAllSourceOwnedRequests(params.reason),
      hasOutstandingRequest: (requestId) => this.readSourceOwnedOutstandingRequest(requestId) !== null,
      readOutstandingRequest: (requestId) => this.readSourceOwnedOutstandingRequest(requestId),
    };
  }

  private readSourceOwnedOutstandingRequest(requestId: string): AgentStateOutstandingRequest | null {
    const outstanding = this.requestStore.readOutstandingRequest(requestId);
    if (!outstanding) return null;
    const rawRequest = this.session.client.getAgentStateSnapshot?.()?.requests?.[requestId] ?? null;
    return isClaudeUnifiedTerminalResumeChoiceAgentStateRequest(rawRequest) ? outstanding : null;
  }

  private tryHandlePermissionRpc(payload: PermissionRpcPayload): PermissionRpcConsumerOutcome {
    const requestId = typeof payload?.id === 'string' ? payload.id : '';
    if (!requestId) return false;
    const context = this.permissionCoordinator.getResponseContext(requestId);
    if (!isResumeChoiceContext(context)) return false;

    if (payload.approved !== true) {
      const reason = typeof payload.reason === 'string' && payload.reason.length > 0
        ? payload.reason
        : 'claude_unified_resume_choice_denied';
      this.completeSourceOwnedCancellation(requestId, reason);
      return true;
    }

    const resumeChoice = decodeResumeChoice(payload);
    if (!resumeChoice) {
      throw new Error('invalid_resume_choice_answer');
    }

    return this.permissionCoordinator.completeResponse({
      context,
      completion: {
        result: resumeChoice,
        completedRequest: {
          status: 'approved',
          decision: 'allow',
          extraCompletedFields: {
            answers: payload.answers ?? {},
            resumeChoice,
          },
        },
      },
    });
  }

  private completeSourceOwnedCancellation(requestId: string, reason: string): void {
    const outstanding = this.readSourceOwnedOutstandingRequest(requestId);
    this.permissionCoordinator.cancelRequest(requestId, reason);
    this.requestStore.completeRequest({
      requestId,
      status: 'canceled',
      decision: 'abort',
      reason,
      fallback: outstanding
        ? {
          toolName: outstanding.toolName,
          toolInput: outstanding.toolInput,
          createdAt: outstanding.createdAt,
          kind: outstanding.kind,
          source: CLAUDE_UNIFIED_TERMINAL_RESUME_CHOICE_REQUEST_SOURCE,
        }
        : null,
    });
    if (this.pendingChoice?.requestId === requestId) {
      this.pendingChoice = null;
    }
  }

  private cancelAllSourceOwnedRequests(reason: string): void {
    const requests = this.session.client.getAgentStateSnapshot?.()?.requests ?? {};
    for (const [requestId, request] of Object.entries(requests)) {
      if (!isClaudeUnifiedTerminalResumeChoiceAgentStateRequest(request)) continue;
      this.completeSourceOwnedCancellation(requestId, reason);
    }
  }
}
