import type { SessionClientPort } from '@/api/session/sessionClientPort';
import { logger } from '@/ui/logger';
import type { ClaudeUnifiedPromptEchoSuppressor } from './promptEchoSuppression';

export const CLAUDE_UNIFIED_PROMPT_ECHO_SEED_TAKE = 500;

export async function seedClaudeUnifiedPersistedPromptEchoes(params: Readonly<{
  session: Pick<SessionClientPort, 'fetchRecentTranscriptTextItemsForAcpImport'>;
  suppressor: Pick<ClaudeUnifiedPromptEchoSuppressor, 'recordPersistedUserPromptTexts'>;
  logPrefix: string;
  nowMs?: number;
}>): Promise<void> {
  if (typeof params.session.fetchRecentTranscriptTextItemsForAcpImport !== 'function') return;
  const suppressBeforeMs = params.nowMs ?? Date.now();
  try {
    const items = await params.session.fetchRecentTranscriptTextItemsForAcpImport({
      take: CLAUDE_UNIFIED_PROMPT_ECHO_SEED_TAKE,
    });
    params.suppressor.recordPersistedUserPromptTexts(
      items
        .filter((item) => item.role === 'user')
        .map((item) => ({ text: item.text, suppressBeforeMs })),
    );
  } catch (error) {
    logger.debug(`${params.logPrefix}: failed to seed Claude unified persisted prompt echoes`, error);
  }
}
