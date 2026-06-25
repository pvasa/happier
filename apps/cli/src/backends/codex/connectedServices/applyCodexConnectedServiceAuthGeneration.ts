import { evaluateCodexConnectedServiceHotApplyEligibility } from './authApplication/eligibility';
import { applyCodexDirectLiveAppServerAuth } from './authApplication/liveAppServerApply';
import type {
  CodexDirectLiveAuthApplyInput,
  CodexDirectLiveAuthApplyResult,
  CodexHotApplyEligibility,
} from './authApplication/types';

export {
  evaluateCodexConnectedServiceHotApplyEligibility,
  type CodexHotApplyEligibility,
};

export async function applyCodexConnectedServiceAuthGeneration(
  params: CodexDirectLiveAuthApplyInput,
): Promise<CodexDirectLiveAuthApplyResult> {
  return await applyCodexDirectLiveAppServerAuth(params);
}

export async function recoverCodexConnectedServiceRestartResumeOnce(params: Readonly<{
  attemptsSoFar: number;
  restartAndResume: () => Promise<Readonly<{ resumed: true }>>;
}>): Promise<
  | Readonly<{ recovered: true; via: 'restart' }>
  | Readonly<{ recovered: false; reason: 'retry_limit_reached' }>
> {
  if (params.attemptsSoFar >= 1) {
    return { recovered: false, reason: 'retry_limit_reached' };
  }
  await params.restartAndResume();
  return { recovered: true, via: 'restart' };
}
