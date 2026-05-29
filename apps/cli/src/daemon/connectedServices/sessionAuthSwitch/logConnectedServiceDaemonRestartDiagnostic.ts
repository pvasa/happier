import { logger } from '@/ui/logger';

import type { ConnectedServiceDaemonRestartDiagnosticRecord } from './requestConnectedServiceSessionRestartSignal';

export function logConnectedServiceDaemonRestartDiagnostic(
  record: ConnectedServiceDaemonRestartDiagnosticRecord,
): void {
  logger.info('[DAEMON RUN] Connected-service daemon restart diagnostic', record);
}
