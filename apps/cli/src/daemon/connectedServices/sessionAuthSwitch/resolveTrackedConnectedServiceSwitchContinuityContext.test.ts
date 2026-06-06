import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { resolveTrackedConnectedServiceSwitchContinuityContext } from './resolveTrackedConnectedServiceSwitchContinuityContext';

describe('resolveTrackedConnectedServiceSwitchContinuityContext', () => {
  it('derives materialized root/env and persisted session-file candidate from tracked resume options', () => {
    const baseDir = '/tmp/happier-connected-services';
    const piSessionFile = join(
      baseDir,
      'csm_pi',
      'pi',
      'pi-agent-dir',
      'sessions',
      '--tmp-project--',
      '2026-06-01T00-00-00-000Z_pi-session-1.jsonl',
    );

    expect(resolveTrackedConnectedServiceSwitchContinuityContext({
      agentId: 'pi',
      baseDir,
      tracked: {
        spawnOptions: {
          directory: '/tmp/project',
          resume: piSessionFile,
          connectedServiceMaterializationIdentityV1: {
            v: 1,
            id: 'csm_pi',
            createdAtMs: 1,
          },
        },
      },
      connectedServiceMaterializationIdentityV1: null,
      vendorResumeId: null,
      cwd: null,
      candidatePersistedSessionFile: null,
    })).toEqual({
      connectedServiceMaterializationIdentityV1: {
        v: 1,
        id: 'csm_pi',
        createdAtMs: 1,
      },
      targetMaterializedRoot: join(baseDir, 'csm_pi', 'pi'),
      targetMaterializedEnv: {
        HAPPIER_CONNECTED_SERVICE_TARGET_MATERIALIZED_ROOT: join(baseDir, 'csm_pi', 'pi'),
      },
      vendorResumeId: piSessionFile,
      cwd: '/tmp/project',
      candidatePersistedSessionFile: piSessionFile,
    });
  });

  it('falls back to durable metadata for identity and provider resume context', () => {
    const baseDir = '/tmp/happier-connected-services';
    const piSessionFile = join(
      baseDir,
      'native',
      'pi-agent-dir',
      'sessions',
      '--tmp-project--',
      '2026-06-01T00-00-00-000Z_pi-session-from-metadata.jsonl',
    );

    expect(resolveTrackedConnectedServiceSwitchContinuityContext({
      agentId: 'pi',
      baseDir,
      tracked: {
        happySessionMetadataFromLocalWebhook: {
          path: '/tmp/project',
          host: 'host',
          homeDir: '/home/user',
          happyHomeDir: '/home/user/.happy',
          happyLibDir: '/home/user/.happy/lib',
          happyToolsDir: '/home/user/.happy/tools',
          connectedServiceMaterializationIdentityV1: {
            v: 1,
            id: 'csm_metadata_pi',
            createdAtMs: 1,
          },
          agentRuntimeDescriptorV1: {
            v: 1,
            providerId: 'pi',
            provider: {
              resumeStrategy: 'sessionFileAbsolutePreferred',
              vendorSessionId: 'pi-session-from-metadata',
              sessionFile: piSessionFile,
            },
          },
          piSessionFile,
        },
        spawnOptions: {
          directory: '/tmp/project',
        },
      },
      connectedServiceMaterializationIdentityV1: null,
      vendorResumeId: null,
      cwd: null,
      candidatePersistedSessionFile: null,
    })).toEqual({
      connectedServiceMaterializationIdentityV1: {
        v: 1,
        id: 'csm_metadata_pi',
        createdAtMs: 1,
      },
      targetMaterializedRoot: join(baseDir, 'csm_metadata_pi', 'pi'),
      targetMaterializedEnv: {
        HAPPIER_CONNECTED_SERVICE_TARGET_MATERIALIZED_ROOT: join(baseDir, 'csm_metadata_pi', 'pi'),
      },
      vendorResumeId: piSessionFile,
      cwd: '/tmp/project',
      candidatePersistedSessionFile: piSessionFile,
    });
  });

  it('keeps tracked resume id and persisted-file candidate from the same source before stale metadata', () => {
    const baseDir = '/tmp/happier-connected-services';
    const trackedPiSessionFile = join(
      baseDir,
      'native',
      'pi-agent-dir',
      'sessions',
      '--tmp-project--',
      '2026-06-01T00-00-00-000Z_pi-session-tracked.jsonl',
    );
    const staleMetadataPiSessionFile = join(
      baseDir,
      'native',
      'pi-agent-dir',
      'sessions',
      '--tmp-project--',
      '2026-06-01T00-00-00-000Z_pi-session-stale.jsonl',
    );

    expect(resolveTrackedConnectedServiceSwitchContinuityContext({
      agentId: 'pi',
      baseDir,
      tracked: {
        happySessionMetadataFromLocalWebhook: {
          path: '/tmp/project',
          host: 'host',
          homeDir: '/home/user',
          happyHomeDir: '/home/user/.happy',
          happyLibDir: '/home/user/.happy/lib',
          happyToolsDir: '/home/user/.happy/tools',
          connectedServiceMaterializationIdentityV1: {
            v: 1,
            id: 'csm_metadata_pi',
            createdAtMs: 1,
          },
          piSessionId: 'pi-session-stale',
          piSessionFile: staleMetadataPiSessionFile,
        },
        spawnOptions: {
          directory: '/tmp/project',
          resume: trackedPiSessionFile,
        },
      },
      connectedServiceMaterializationIdentityV1: null,
      vendorResumeId: null,
      cwd: null,
      candidatePersistedSessionFile: null,
    })).toMatchObject({
      vendorResumeId: trackedPiSessionFile,
      candidatePersistedSessionFile: trackedPiSessionFile,
    });
  });
});
