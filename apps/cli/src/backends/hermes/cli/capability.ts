import { DefaultTransport } from '@/agent/transport';
import { createAcpCliCapability } from '@/capabilities/probes/createAcpCliCapability';

export const cliCapability = createAcpCliCapability({
  agentId: 'hermes',
  title: 'Hermes Agent CLI',
  acpArgs: ['acp'],
  transport: new DefaultTransport('hermes'),
});
