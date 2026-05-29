import type { StartedDaemon } from '../daemon/daemon';

type SpawnSessionSuccessResponse = Readonly<{
  success: true;
  sessionId: string;
}>;

function isSpawnSessionSuccessResponse(value: unknown): value is SpawnSessionSuccessResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    'success' in value &&
    value.success === true &&
    'sessionId' in value &&
    typeof value.sessionId === 'string'
  );
}

export async function spawnSessionFromDaemon(params: Readonly<{
  daemon: StartedDaemon;
  directory: string;
  agent?: string;
}>): Promise<string> {
  const token = params.daemon.state.controlToken;
  if (!token) throw new Error('daemon control token missing');

  const res = await fetch(`http://127.0.0.1:${params.daemon.state.httpPort}/spawn-session`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-happier-daemon-token': token,
    },
    body: JSON.stringify({
      directory: params.directory,
      ...(params.agent
        ? { backendTarget: { kind: 'builtInAgent', agentId: params.agent } }
        : {}),
    }),
  });
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok || !isSpawnSessionSuccessResponse(json)) {
    throw new Error(`Failed to spawn session (status=${res.status}): ${JSON.stringify(json)}`);
  }
  return json.sessionId;
}
