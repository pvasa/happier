import { beforeEach, describe, expect, it, vi } from 'vitest';
import { delimiter } from 'node:path';

const {
  buildAcpCapabilitySnapshot,
  probeAcpAgentCapabilities,
  requireProviderCliLaunchSpec,
  resolveAcpProbeTimeoutMs,
} = vi.hoisted(() => ({
  buildAcpCapabilitySnapshot: vi.fn(() => ({ ok: true, loadSession: true })),
  probeAcpAgentCapabilities: vi.fn(),
  requireProviderCliLaunchSpec: vi.fn(),
  resolveAcpProbeTimeoutMs: vi.fn(() => 12_345),
}));

vi.mock('@/capabilities/probes/acpCapabilitySnapshot', () => ({
  buildAcpCapabilitySnapshot,
}));

vi.mock('@/capabilities/probes/acpProbe', () => ({
  probeAcpAgentCapabilities,
}));

vi.mock('@/capabilities/utils/acpProbeTimeout', () => ({
  resolveAcpProbeTimeoutMs,
}));

vi.mock('@/runtime/managedTools/requireProviderCliLaunchSpec', () => ({
  requireProviderCliLaunchSpec,
}));

import { createAcpCliCapability } from './createAcpCliCapability';
import { cliCapability as kimiCliCapability } from '@/backends/kimi/cli/capability';

describe('createAcpCliCapability', () => {
  beforeEach(() => {
    buildAcpCapabilitySnapshot.mockClear();
    probeAcpAgentCapabilities.mockReset();
    requireProviderCliLaunchSpec.mockReset();
    resolveAcpProbeTimeoutMs.mockClear();
    probeAcpAgentCapabilities.mockResolvedValue({
      ok: true,
      capabilities: { loadSession: true },
    });
    requireProviderCliLaunchSpec.mockReturnValue({
      source: 'managed',
      resolvedPath: '/tmp/gemini.js',
      command: '/runtime/node',
      args: ['/tmp/gemini.js'],
    });
  });

  it('uses the canonical provider launch command for ACP probing when the CLI needs a runtime wrapper', async () => {
    const capability = createAcpCliCapability({
      agentId: 'gemini' as const,
      title: 'Gemini CLI',
      acpArgs: ['--acp'],
      transport: {
        agentName: 'gemini',
        getInitTimeout: () => 500,
        getToolPatterns: () => [],
      },
      resolveAcpProbeArgs: async () => ['--experimental-acp'],
    });

    const result = await capability.detect?.({
      request: { id: 'cli.gemini', params: { includeAcpCapabilities: true } },
      context: {
        cliSnapshot: {
          path: process.env.PATH ?? null,
          clis: {
            gemini: { available: true, resolvedPath: '/tmp/gemini.js' },
          },
        },
      },
    } as never);

    expect(probeAcpAgentCapabilities).toHaveBeenCalledWith(expect.objectContaining({
      command: '/runtime/node',
      args: ['/tmp/gemini.js', '--experimental-acp'],
      timeoutMs: 12_345,
    }));
    expect(buildAcpCapabilitySnapshot).toHaveBeenCalledWith({
      ok: true,
      capabilities: { loadSession: true },
    });
    expect(result).toMatchObject({
      available: true,
      resolvedPath: '/tmp/gemini.js',
      acp: { ok: true, loadSession: true },
    });
  });

  it('allows provider-owned ACP probes to augment the child environment', async () => {
    const capability = createAcpCliCapability({
      agentId: 'kimi' as const,
      title: 'Kimi CLI',
      acpArgs: ['acp'],
      transport: {
        agentName: 'kimi',
        getInitTimeout: () => 500,
        getToolPatterns: () => [],
      },
      resolveAcpProbeEnv: ({ defaultEnv }) => ({
        ...defaultEnv,
        PYTHONPATH: '/tmp/kimi-selector-shim',
      }),
    });

    await capability.detect?.({
      request: { id: 'cli.kimi', params: { includeAcpCapabilities: true } },
      context: {
        cliSnapshot: {
          path: process.env.PATH ?? null,
          clis: {
            kimi: { available: true, resolvedPath: '/tmp/gemini.js' },
          },
        },
      },
    } as never);

    expect(probeAcpAgentCapabilities).toHaveBeenCalledWith(expect.objectContaining({
      env: expect.objectContaining({
        PYTHONPATH: '/tmp/kimi-selector-shim',
      }),
    }));
  });

  it('preserves inherited PYTHONPATH when Kimi ACP capability probing uses poll mode', async () => {
    const originalPlatformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform');
    const originalSelector = process.env.HAPPIER_KIMI_ACP_SELECTOR;
    const originalPythonPath = process.env.PYTHONPATH;
    const originalSecret = process.env.HAPPIER_TEST_SECRET;
    expect(originalPlatformDescriptor).toBeDefined();

    try {
      Object.defineProperty(process, 'platform', { ...originalPlatformDescriptor, value: 'linux' });
      process.env.HAPPIER_KIMI_ACP_SELECTOR = 'poll';
      process.env.PYTHONPATH = '/inherited/pythonpath';
      process.env.HAPPIER_TEST_SECRET = 'do-not-forward';

      await kimiCliCapability.detect?.({
        request: { id: 'cli.kimi', params: { includeAcpCapabilities: true } },
        context: {
          cliSnapshot: {
            path: process.env.PATH ?? null,
            clis: {
              kimi: { available: true, resolvedPath: '/tmp/gemini.js' },
            },
          },
        },
      } as never);

      const env = probeAcpAgentCapabilities.mock.calls.at(-1)?.[0]?.env;
      const pythonPathEntries = env?.PYTHONPATH?.split(delimiter) ?? [];
      expect(pythonPathEntries[0]).toContain('kimi-acp-poll-selector-');
      expect(pythonPathEntries).toContain('/inherited/pythonpath');
      expect(env).toMatchObject({
        NODE_ENV: 'production',
        DEBUG: '',
      });
      expect(env?.HAPPIER_TEST_SECRET).toBeUndefined();
    } finally {
      if (originalPlatformDescriptor) {
        Object.defineProperty(process, 'platform', originalPlatformDescriptor);
      }
      if (originalSelector === undefined) {
        delete process.env.HAPPIER_KIMI_ACP_SELECTOR;
      } else {
        process.env.HAPPIER_KIMI_ACP_SELECTOR = originalSelector;
      }
      if (originalPythonPath === undefined) {
        delete process.env.PYTHONPATH;
      } else {
        process.env.PYTHONPATH = originalPythonPath;
      }
      if (originalSecret === undefined) {
        delete process.env.HAPPIER_TEST_SECRET;
      } else {
        process.env.HAPPIER_TEST_SECRET = originalSecret;
      }
    }
  });
});
