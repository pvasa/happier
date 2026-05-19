import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeSocket, getSocketHandler } from "../testkit/socketHarness";

const emitEphemeral = vi.fn();
const buildUsageEphemeral = vi.fn(() => ({ type: "usage" }));

vi.mock("@/app/events/eventRouter", () => ({
    eventRouter: { emitEphemeral },
    buildUsageEphemeral,
}));

vi.mock("@/utils/logging/log", () => ({ log: vi.fn() }));

const dbSessionFindFirst = vi.fn();
const dbUsageReportUpsert = vi.fn();
const txSessionFindFirst = vi.fn();
const txUsageReportUpsert = vi.fn();
const inTx = vi.fn(async (run: (tx: unknown) => Promise<unknown>) => run({
    session: { findFirst: txSessionFindFirst },
    usageReport: { upsert: txUsageReportUpsert },
}));

vi.mock("@/storage/db", () => ({
    db: {
        session: { findFirst: dbSessionFindFirst },
        usageReport: { upsert: dbUsageReportUpsert },
    },
}));

vi.mock("@/storage/inTx", () => ({ inTx, afterTx: vi.fn() }));

describe("usageHandler usage writes", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        dbSessionFindFirst.mockResolvedValue({ id: "s1" });
        dbUsageReportUpsert.mockRejectedValue(Object.assign(new Error("Socket timeout"), { code: "P1008" }));
        txSessionFindFirst.mockResolvedValue({ id: "s1" });
        txUsageReportUpsert.mockResolvedValue({
            id: "report-1",
            createdAt: new Date("2026-01-01T00:00:00.000Z"),
            updatedAt: new Date("2026-01-01T00:00:01.000Z"),
        });
    });

    it("records socket usage reports through the transactional retry path", async () => {
        const { usageHandler } = await import("./usageHandler");
        const socket = createFakeSocket();
        usageHandler("u1", socket as any);

        const callback = vi.fn();
        await getSocketHandler(socket, "usage-report")({
            key: "k1",
            sessionId: "s1",
            tokens: { total: 10, prompt: 4 },
            cost: { total: 0.25 },
        }, callback);

        expect(callback).toHaveBeenCalledWith(expect.objectContaining({
            success: true,
            reportId: "report-1",
        }));
        expect(inTx).toHaveBeenCalledTimes(1);
        expect(txSessionFindFirst).toHaveBeenCalledWith({
            where: { id: "s1", accountId: "u1" },
            select: { id: true },
        });
        expect(txUsageReportUpsert).toHaveBeenCalledWith(expect.objectContaining({
            where: {
                accountId_sessionId_key: {
                    accountId: "u1",
                    sessionId: "s1",
                    key: "k1",
                },
            },
        }));
        expect(dbUsageReportUpsert).not.toHaveBeenCalled();
        expect(emitEphemeral).toHaveBeenCalledTimes(1);
    });
});
