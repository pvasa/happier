import type {
  TerminalHostKind,
  TerminalInputInjectionResult,
} from '@happier-dev/agents';
import type { TerminalHostLiveness } from '@/integrations/terminalHost/_types';

import { logger as defaultLogger } from '@/ui/logger';

type LoggerLike = Readonly<{
  debug(message: string, ...args: unknown[]): void;
}>;

type TelemetryReason = string;

export type ClaudeUnifiedTelemetryEvent =
  | Readonly<{
      name: 'unified.session.host_resolved';
      properties: Readonly<{
        kind: TerminalHostKind | 'disabled';
        platform: NodeJS.Platform;
        preference: 'auto' | TerminalHostKind;
        reason: TelemetryReason;
      }>;
    }>
    | Readonly<{
        name: 'unified.injection.outcome';
        properties: Readonly<{
        status: TerminalInputInjectionResult['status'];
        reason?: TelemetryReason | undefined;
        phase?: string | undefined;
        duplicateRisk?: string | undefined;
        recoverable?: boolean | undefined;
        hostKind: TerminalHostKind;
        multiline: boolean;
          originKind: 'ui_pending' | 'ui_immediate' | 'rpc';
        }>;
      }>
    | Readonly<{
        name: 'unified.session.host_dead';
        properties: Readonly<{
          hostKind: TerminalHostKind;
          sessionName: string;
          paneId?: string | undefined;
          paneAlive: boolean;
            paneDead?: boolean | undefined;
            panePid?: number | undefined;
            paneCurrentCommand?: string | undefined;
            paneExitStatus?: number | undefined;
            paneScreenDumpCaptured?: boolean | undefined;
            paneScreenDumpTruncated?: boolean | undefined;
            paneScreenDumpErrorCaptured?: boolean | undefined;
            observedAt: number;
          }>;
        }>
    | Readonly<{
        name: 'unified.lifecycle.gap_detected';
      properties: Readonly<{
        source: 'fd3_fetch_fallback';
        signal: 'fetch_start' | 'fetch_idle_clear';
        activeFetchCount: number;
      }>;
    }>
  | Readonly<{
      name: 'unified.session.windows_guard_triggered';
      properties: Readonly<{
        guard:
          | 'windows_arm64_unsupported'
          | 'windows_default_shell_cmd';
        hostKind: 'zellij';
        platform: 'win32';
      }>;
    }>;

export type ClaudeUnifiedTelemetrySink = Readonly<{
  emit(event: ClaudeUnifiedTelemetryEvent): void;
}>;

function sanitizeReason(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9_.:-]+/g, '_').slice(0, 80);
  return normalized.length > 0 ? normalized : 'unknown';
}

function buildLogPayload(event: ClaudeUnifiedTelemetryEvent): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    event: event.name,
    ...event.properties,
  };
  if (typeof payload.reason === 'string') {
    payload.reason = sanitizeReason(payload.reason);
  }
  return payload;
}

export function createClaudeUnifiedTelemetrySink(params?: Readonly<{
  logger?: LoggerLike | undefined;
}>): ClaudeUnifiedTelemetrySink {
  const logger = params?.logger ?? defaultLogger;
  return {
    emit(event) {
      logger.debug('[claude-unified-telemetry]', buildLogPayload(event));
    },
  };
}

export function emitClaudeUnifiedInjectionOutcome(
  telemetry: ClaudeUnifiedTelemetrySink,
  params: Readonly<{
    result: TerminalInputInjectionResult;
    hostKind: TerminalHostKind;
    multiline: boolean;
    originKind: 'ui_pending' | 'ui_immediate' | 'rpc';
  }>,
): void {
  telemetry.emit({
    name: 'unified.injection.outcome',
    properties: {
      status: params.result.status,
      ...(params.result.status === 'injected' ? {} : { reason: params.result.reason }),
      ...(params.result.status === 'failed'
        ? {
            phase: params.result.phase,
            duplicateRisk: params.result.duplicateRisk,
            recoverable: params.result.recoverable,
          }
        : {}),
      hostKind: params.hostKind,
      multiline: params.multiline,
      originKind: params.originKind,
    },
  });
}

export function emitClaudeUnifiedLifecycleGapDetected(
  telemetry: ClaudeUnifiedTelemetrySink,
  properties: Extract<ClaudeUnifiedTelemetryEvent, { name: 'unified.lifecycle.gap_detected' }>['properties'],
): void {
  telemetry.emit({
    name: 'unified.lifecycle.gap_detected',
    properties,
  });
}

export function emitClaudeUnifiedHostDead(
  telemetry: ClaudeUnifiedTelemetrySink,
  params: Readonly<{
    hostKind: TerminalHostKind;
    sessionName: string;
    paneId?: string | undefined;
    liveness?: TerminalHostLiveness | undefined;
  }>,
): void {
  telemetry.emit({
    name: 'unified.session.host_dead',
    properties: {
      hostKind: params.hostKind,
      sessionName: params.sessionName,
      ...(params.paneId ? { paneId: params.paneId } : {}),
      paneAlive: params.liveness?.paneAlive ?? false,
      ...(params.liveness?.paneDead !== undefined ? { paneDead: params.liveness.paneDead } : {}),
      ...(params.liveness?.panePid !== undefined ? { panePid: params.liveness.panePid } : {}),
      ...(params.liveness?.paneCurrentCommand ? { paneCurrentCommand: params.liveness.paneCurrentCommand } : {}),
      ...(params.liveness?.paneExitStatus !== undefined ? { paneExitStatus: params.liveness.paneExitStatus } : {}),
      ...(params.liveness?.paneScreenDumpCaptured ? { paneScreenDumpCaptured: true } : {}),
      ...(params.liveness?.paneScreenDumpTruncated !== undefined ? { paneScreenDumpTruncated: params.liveness.paneScreenDumpTruncated } : {}),
      ...(params.liveness?.paneScreenDumpError ? { paneScreenDumpErrorCaptured: true } : {}),
      observedAt: params.liveness?.observedAt ?? Date.now(),
    },
  });
}

export function emitClaudeUnifiedWindowsGuardTriggered(
  telemetry: ClaudeUnifiedTelemetrySink,
  guard: Extract<ClaudeUnifiedTelemetryEvent, { name: 'unified.session.windows_guard_triggered' }>['properties']['guard'],
): void {
  telemetry.emit({
    name: 'unified.session.windows_guard_triggered',
    properties: {
      guard,
      hostKind: 'zellij',
      platform: 'win32',
    },
  });
}

export function maybeEmitClaudeUnifiedWindowsGuardTriggered(
  telemetry: ClaudeUnifiedTelemetrySink,
  reason: string,
): void {
  if (
    reason === 'windows_arm64_unsupported'
  ) {
    emitClaudeUnifiedWindowsGuardTriggered(telemetry, reason);
  }
}
