import type {
  AccountSettings,
  ConnectedServiceCredentialRecordV1,
  ConnectedServiceId,
} from '@happier-dev/protocol';
import type { CatalogAgentId } from '@/backends/types';
import type { ConnectedServiceResolvedSelection } from './materializeConnectedServicesForSpawn';

export type ConnectedServicesMaterializationDiagnostic = Readonly<{
  code: string;
  providerId: CatalogAgentId;
  serviceId?: ConnectedServiceId;
  requestedStateMode?: string;
  effectiveStateMode?: string;
  entryName?: string;
  reason?: string;
}>;

export type ConnectedServicesMaterializeResult = Readonly<{
  env: Record<string, string>;
  cleanupOnFailure: (() => void) | null;
  cleanupOnExit: (() => void) | null;
  diagnostics?: readonly ConnectedServicesMaterializationDiagnostic[];
}>;

export type ConnectedServicesProviderMaterializerInput = Readonly<{
  agentId: CatalogAgentId;
  activeServerDir: string;
  rootDir: string;
  sessionDirectory?: string | null;
  recordsByServiceId: ReadonlyMap<ConnectedServiceId, ConnectedServiceCredentialRecordV1>;
  selectionsByServiceId?: ReadonlyMap<ConnectedServiceId, ConnectedServiceResolvedSelection>;
  accountSettings?: AccountSettings | Readonly<Record<string, unknown>> | null;
  processEnv?: NodeJS.ProcessEnv;
  cleanupRoot: () => void;
}>;

export type ConnectedServicesProviderMaterializer = (
  params: ConnectedServicesProviderMaterializerInput,
) => Promise<ConnectedServicesMaterializeResult | null>;
