import { createAcpCliCapability } from '@/capabilities/probes/createAcpCliCapability';
import { resolveKimiAcpPythonSelectorChildEnv } from '@/backends/kimi/acp/pythonSelectorEnv';
import { kimiTransport } from '@/backends/kimi/acp/transport';

export const cliCapability = createAcpCliCapability({
  agentId: 'kimi',
  title: 'Kimi CLI',
  acpArgs: ['acp'],
  transport: kimiTransport,
  resolveAcpProbeEnv: ({ defaultEnv }) => resolveKimiAcpPythonSelectorChildEnv({
    selector: process.env.HAPPIER_KIMI_ACP_SELECTOR,
    env: defaultEnv,
    inheritedEnv: process.env,
  }),
});
