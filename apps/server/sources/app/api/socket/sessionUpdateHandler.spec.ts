import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSocket, getSocketHandler } from "../testkit/socketHarness";

const createSessionMessage = vi.fn(async () => ({ ok: false, error: "invalid-params" }));
const updateSessionAgentState = vi.fn(async (): Promise<unknown> => ({ ok: false, error: "internal" }));
const emitEphemeral = vi.fn();
vi.mock("@/app/session/sessionWriteService", () => ({
    createSessionMessage,
    updateSessionMetadata: vi.fn(async () => ({ ok: false, error: "internal" })),
    updateSessionAgentState,
}));
vi.mock("@/app/events/eventRouter", () => ({
    eventRouter: {
        emitEphemeral,
        emitUpdate: vi.fn(),
    },
    buildMessageUpdatedUpdate: vi.fn(),
    buildNewMessageUpdate: vi.fn(),
    buildPendingChangedUpdate: vi.fn(),
    buildSessionActivityEphemeral: vi.fn(),
    buildUpdateSessionUpdate: vi.fn(),
}));

const checkSessionAccess = vi.fn(async () => ({
    userId: "user-1",
    sessionId: "s-1",
    level: "owner",
    isOwner: true,
}));
const requireAccessLevel = vi.fn(() => true);
vi.mock("@/app/share/accessControl", () => ({
    checkSessionAccess,
    requireAccessLevel,
}));

const getSessionParticipantUserIds = vi.fn(async () => ["user-1"]);
vi.mock("@/app/share/sessionParticipants", () => ({
    getSessionParticipantUserIds,
}));
vi.mock("@/utils/logging/log", () => ({ log: vi.fn() }));

describe("sessionUpdateHandler", () => {
    let registerSessionUpdateHandler: (userId: string, socket: any, connection: any) => void;

    beforeAll(async () => {
        ({ sessionUpdateHandler: registerSessionUpdateHandler } = await import("./sessionUpdateHandler"));
    }, 120_000);

    beforeEach(() => {
        createSessionMessage.mockClear();
        updateSessionAgentState.mockClear();
        emitEphemeral.mockClear();
        checkSessionAccess.mockClear();
        requireAccessLevel.mockClear();
        getSessionParticipantUserIds.mockClear();
    });

    it("does not crash on invalid message payloads and acks with invalid-params when callback is provided", async () => {
        const socket = createFakeSocket();

        registerSessionUpdateHandler(
            "user-1",
            socket as any,
            // minimal connection object for logging
            { connectionType: "session-scoped", socket: socket as any, userId: "user-1", sessionId: "s-1" } as any,
        );

        const handler = getSocketHandler(socket, "message");

        const callback = vi.fn();
        await handler({ sid: "s-1" }, callback); // missing message

        expect(callback).toHaveBeenCalledWith(
            expect.objectContaining({
                ok: false,
                error: "invalid-params",
            }),
        );
    });

    it("does not crash on invalid message payloads when callback is missing (old clients)", async () => {
        const socket = createFakeSocket();

        registerSessionUpdateHandler(
            "user-1",
            socket as any,
            { connectionType: "session-scoped", socket: socket as any, userId: "user-1", sessionId: "s-1" } as any,
        );

        const handler = getSocketHandler(socket, "message");

        await expect(handler({ sid: "s-1" })).resolves.toBeUndefined();
    });

    it("accepts plain message envelopes and forwards them to createSessionMessage", async () => {
        const socket = createFakeSocket();

        registerSessionUpdateHandler(
            "user-1",
            socket as any,
            { connectionType: "session-scoped", socket: socket as any, userId: "user-1", sessionId: "s-1" } as any,
        );

        const handler = getSocketHandler(socket, "message");
        const callback = vi.fn();
        await handler({ sid: "s-1", message: { t: "plain", v: { type: "user", text: "hi" } } }, callback);

        expect(createSessionMessage).toHaveBeenCalledWith({
            actorUserId: "user-1",
            sessionId: "s-1",
            content: { t: "plain", v: { type: "user", text: "hi" } },
            localId: null,
            sidechainId: null,
        });
        expect(callback).toHaveBeenCalledWith(expect.objectContaining({ ok: false, error: "invalid-params" }));
    });

    it("does not crash when plain message envelopes contain unserializable payloads", async () => {
        const socket = createFakeSocket();

        registerSessionUpdateHandler(
            "user-1",
            socket as any,
            { connectionType: "session-scoped", socket: socket as any, userId: "user-1", sessionId: "s-1" } as any,
        );

        const circular: any = { kind: "circular" };
        circular.self = circular;

        const handler = getSocketHandler(socket, "message");
        const callback = vi.fn();
        await handler({ sid: "s-1", message: { t: "plain", v: circular } }, callback);

        expect(createSessionMessage).toHaveBeenCalledWith({
            actorUserId: "user-1",
            sessionId: "s-1",
            content: { t: "plain", v: circular },
            localId: null,
            sidechainId: null,
        });
        expect(callback).toHaveBeenCalledWith(expect.objectContaining({ ok: false, error: "invalid-params" }));
    });

    it("drops malformed runtime issue projections from socket update-state payloads", async () => {
        updateSessionAgentState.mockResolvedValueOnce({
            ok: true,
            agentState: "{}",
            version: 2,
            participantCursors: [],
            badgeAttentionChanged: false,
        });
        const socket = createFakeSocket();

        registerSessionUpdateHandler(
            "user-1",
            socket as any,
            { connectionType: "session-scoped", socket: socket as any, userId: "user-1", sessionId: "s-1" } as any,
        );

        const handler = getSocketHandler(socket, "update-state");
        const callback = vi.fn();
        await handler({
            sid: "s-1",
            agentState: "{}",
            expectedVersion: 1,
            runtimeIssueSummaryV1: {
                latestTurnStatus: "failed",
                lastRuntimeIssue: { v: 1, status: "failed" },
            },
        }, callback);

        expect(updateSessionAgentState).toHaveBeenCalledWith({
            actorUserId: "user-1",
            sessionId: "s-1",
            expectedVersion: 1,
            agentStateCiphertext: "{}",
        });
        expect(callback).toHaveBeenCalledWith({ result: "success", version: 2, agentState: "{}" });
    });

});
