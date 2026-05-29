import { notifyDaemonConnectedServiceRuntimeAuthFailure } from '@/daemon/controlClient';
import { logger as defaultLogger } from '@/ui/logger';
import { resolveConnectedServiceRuntimeAuthFailureStatusMessage } from './resolveConnectedServiceRuntimeAuthFailureStatusMessage';

type RuntimeAuthFailureNotifyBody = Readonly<{
  sessionId: string;
  switchesThisTurn?: number;
  classification: unknown;
}>;

type RuntimeAuthFailureNotify = (body: RuntimeAuthFailureNotifyBody) => Promise<unknown>;

type RuntimeAuthFailureLogger = Readonly<{
  debug: (message: string, error?: unknown) => void;
}>;

export type ConnectedServiceRuntimeAuthFailureDaemonReport = Readonly<{
  handled: boolean;
  report: unknown | null;
  statusCode: string | null;
  statusMessage: string | null;
}>;

export async function reportConnectedServiceRuntimeAuthFailureToDaemon(input: Readonly<{
  sessionId: string;
  switchesThisTurn?: number;
  classification: unknown;
  notify?: RuntimeAuthFailureNotify;
  logger?: RuntimeAuthFailureLogger;
  logPrefix?: string;
}>): Promise<ConnectedServiceRuntimeAuthFailureDaemonReport> {
  const notify = input.notify ?? notifyDaemonConnectedServiceRuntimeAuthFailure;
  const logger = input.logger ?? defaultLogger;
  const logPrefix = input.logPrefix ?? '[connected-services]';

  try {
    const report = await notify({
      sessionId: input.sessionId,
      switchesThisTurn: input.switchesThisTurn ?? 0,
      classification: input.classification,
    });
    const statusNote = resolveConnectedServiceRuntimeAuthFailureStatusMessage(report);
    return {
      handled: Boolean(statusNote),
      report,
      statusCode: statusNote?.code ?? null,
      statusMessage: statusNote?.message ?? null,
    };
  } catch (error) {
    logger.debug(`${logPrefix} Failed to report connected-service runtime auth failure to daemon (non-fatal)`, error);
    return {
      handled: false,
      report: null,
      statusCode: null,
      statusMessage: null,
    };
  }
}
