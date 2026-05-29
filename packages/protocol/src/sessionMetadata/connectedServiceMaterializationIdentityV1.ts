import { z } from 'zod';

export const CONNECTED_SERVICE_MATERIALIZATION_IDENTITY_METADATA_KEY =
  'connectedServiceMaterializationIdentityV1' as const;

export function createConnectedServiceMaterializationIdentityV1Schema(zod: typeof z) {
  return zod
    .object({
      v: zod.literal(1),
      id: zod
        .string()
        .trim()
        .min(1)
        .max(128)
        .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
      createdAtMs: zod.number().int().nonnegative(),
    })
    .passthrough();
}

export const ConnectedServiceMaterializationIdentityV1Schema =
  createConnectedServiceMaterializationIdentityV1Schema(z);
export type ConnectedServiceMaterializationIdentityV1 =
  z.infer<typeof ConnectedServiceMaterializationIdentityV1Schema>;

export function buildConnectedServiceMaterializationIdentityV1(
  params: Readonly<{ id: string; createdAtMs: number }>,
): ConnectedServiceMaterializationIdentityV1 {
  return ConnectedServiceMaterializationIdentityV1Schema.parse({
    v: 1,
    id: params.id,
    createdAtMs: params.createdAtMs,
  });
}

export function readConnectedServiceMaterializationIdentityV1FromMetadata(
  metadata: unknown,
): ConnectedServiceMaterializationIdentityV1 | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const parsed = ConnectedServiceMaterializationIdentityV1Schema.safeParse(
    (metadata as Record<string, unknown>)[CONNECTED_SERVICE_MATERIALIZATION_IDENTITY_METADATA_KEY],
  );
  return parsed.success ? parsed.data : null;
}
