import {
    ConnectedServiceBindingsV1Schema,
    type ConnectedServiceBindingSelectionV1,
    type ConnectedServiceProfileId,
} from '@happier-dev/protocol';

import {
    resolveConnectedServiceRuntimeAuthContextFromEnv,
    type ConnectedServiceRuntimeAuthContext,
} from '@/daemon/connectedServices/connectedServiceChildEnvironment';

type MetadataReadableSession = Readonly<{
    getMetadataSnapshot?: () => unknown;
}>;

const serviceId = 'openai-codex' as const;

function emptyContext(): ConnectedServiceRuntimeAuthContext {
    return { serviceId, profileId: null, groupId: null };
}

function hasBoundContext(context: ConnectedServiceRuntimeAuthContext): boolean {
    return Boolean(context.profileId || context.groupId);
}

export function resolveCodexConnectedServiceBindingFromSessionMetadata(
    session: MetadataReadableSession,
): ConnectedServiceBindingSelectionV1 | null {
    const metadata = typeof session.getMetadataSnapshot === 'function' ? session.getMetadataSnapshot() : null;
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;

    const rawBindings = (metadata as Record<string, unknown>).connectedServices;
    const parsed = ConnectedServiceBindingsV1Schema.safeParse(rawBindings);
    if (!parsed.success) return null;

    return parsed.data.bindingsByServiceId[serviceId] ?? null;
}

function readMetadataConnectedServiceContext(session: MetadataReadableSession): ConnectedServiceRuntimeAuthContext {
    const binding = resolveCodexConnectedServiceBindingFromSessionMetadata(session);
    if (!binding || binding.source !== 'connected') return emptyContext();

    if (binding.selection === 'group') {
        return {
            serviceId,
            profileId: binding.profileId ?? null,
            groupId: binding.groupId,
        };
    }

    return {
        serviceId,
        profileId: binding.profileId as ConnectedServiceProfileId,
        groupId: null,
    };
}

export function resolveCodexRuntimeAuthClassificationContext(params: Readonly<{
    runtimeEnv: Pick<NodeJS.ProcessEnv, string>;
    session: MetadataReadableSession;
}>): ConnectedServiceRuntimeAuthContext {
    const envContext = resolveConnectedServiceRuntimeAuthContextFromEnv(params.runtimeEnv, serviceId);
    if (hasBoundContext(envContext)) return envContext;
    return readMetadataConnectedServiceContext(params.session);
}
