import type { stat } from 'node:fs/promises';

import { createConnectedServiceSharedStateLink } from '@/daemon/connectedServices/stateSharing/createSharedStateLink';

import { isCodexShareableSqliteStateEntry } from './codexStateFileNames';

type FileStat = Awaited<ReturnType<typeof stat>>;

export async function createCodexSharedStateLink(params: Readonly<{
  sourcePath: string;
  destinationPath: string;
  sourceStat: FileStat;
  entryName: string;
}>): Promise<void> {
  await createConnectedServiceSharedStateLink({
    providerLabel: 'Codex',
    entryName: params.entryName,
    sourcePath: params.sourcePath,
    destinationPath: params.destinationPath,
    sourceStat: params.sourceStat,
    allowHardLinkFallback: !isCodexShareableSqliteStateEntry(params.entryName),
  });
}
