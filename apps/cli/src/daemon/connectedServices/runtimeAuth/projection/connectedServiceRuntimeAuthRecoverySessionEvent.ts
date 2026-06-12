import type { ConnectedServiceRuntimeFailureClassification } from '../types';
import type { ConnectedServiceRuntimeAuthFailureDaemonReport } from '../reportConnectedServiceRuntimeAuthFailureToDaemon';
import type { ConnectedServiceRuntimeAuthRecoveryProjection } from './connectedServiceRuntimeAuthRecoveryProjection';
import type { Metadata } from '@/api/types';
import { buildRuntimeAuthUsageLimitRecoveryMetadataUpdater } from './connectedServiceRuntimeAuthRecoveryUsageLimitMetadata';

export type ConnectedServiceRuntimeAuthRecoveryProjectionResult = Readonly<{
  statusMessageAdded: boolean;
  genericMessageEmitted: boolean;
  typedProjectionCommitted: boolean;
  usageLimitMetadataCommitted: boolean;
  requiresFallback: boolean;
  emitted: boolean;
}>;

export function projectConnectedServiceRuntimeAuthRecoveryReport(input: Readonly<{
  report: ConnectedServiceRuntimeAuthFailureDaemonReport;
  classification?: ConnectedServiceRuntimeFailureClassification;
  addStatusMessage?: (message: string) => boolean | void;
  sendGenericStatusMessage?: (message: string) => boolean | void;
  commitTypedProjection?: (projection: ConnectedServiceRuntimeAuthRecoveryProjection) => boolean | void;
  commitUsageLimitRecoveryMetadata?: (updater: (metadata: Metadata) => Metadata) => boolean | void;
}>): ConnectedServiceRuntimeAuthRecoveryProjectionResult {
  const statusMessage = input.report.statusMessage;
  const projection = input.report.projection;
  let statusMessageAdded = false;
  let genericMessageEmitted = false;
  let typedProjectionCommitted = false;
  let usageLimitMetadataCommitted = false;

  if (statusMessage) {
    const result = input.addStatusMessage?.(statusMessage);
    statusMessageAdded = result === false ? false : Boolean(input.addStatusMessage);
  }

  const hasTypedProjection = Boolean(projection?.uxDiagnostic || projection?.transcriptEvent);
  if (projection && hasTypedProjection && input.commitTypedProjection) {
    const result = input.commitTypedProjection(projection);
    typedProjectionCommitted = typeof result === 'boolean'
      ? result
      : Boolean(projection.transcriptEvent);
  }

  const usageLimitMetadataUpdater = input.classification
    ? buildRuntimeAuthUsageLimitRecoveryMetadataUpdater({
      report: input.report,
      classification: input.classification,
    })
    : null;
  if (usageLimitMetadataUpdater && input.commitUsageLimitRecoveryMetadata) {
    const result = input.commitUsageLimitRecoveryMetadata(usageLimitMetadataUpdater);
    usageLimitMetadataCommitted = result === false ? false : true;
  }

  const requiresFallback = Boolean(statusMessage) && !typedProjectionCommitted;
  if (statusMessage && requiresFallback && input.sendGenericStatusMessage) {
    const result = input.sendGenericStatusMessage(statusMessage);
    genericMessageEmitted = result === false ? false : true;
  }

  return {
    statusMessageAdded,
    genericMessageEmitted,
    typedProjectionCommitted,
    usageLimitMetadataCommitted,
    requiresFallback,
    emitted: statusMessageAdded || genericMessageEmitted || typedProjectionCommitted || usageLimitMetadataCommitted,
  };
}
