import { inTx, type Tx } from "@/storage/inTx";

type UsageReportWriteSummary = Readonly<{
    id: string;
    createdAt: Date;
    updatedAt: Date;
}>;

export type RecordUsageReportResult =
    | Readonly<{
        ok: true;
        report: UsageReportWriteSummary;
        usageData: PrismaJson.UsageReportData;
    }>
    | Readonly<{ ok: false; error: "session-not-found" }>;

export async function recordUsageReportForAccount(params: Readonly<{
    userId: string;
    key: string;
    sessionId?: string | null;
    tokens: PrismaJson.UsageReportData["tokens"];
    cost: PrismaJson.UsageReportData["cost"];
}>): Promise<RecordUsageReportResult> {
    return await inTx(async (tx) => {
        const sessionId = params.sessionId ?? null;
        if (sessionId) {
            const session = await tx.session.findFirst({
                where: { id: sessionId, accountId: params.userId },
                select: { id: true },
            });
            if (!session) return { ok: false, error: "session-not-found" };
        }

        const usageData: PrismaJson.UsageReportData = {
            tokens: params.tokens,
            cost: params.cost,
        };
        const report = sessionId
            ? await tx.usageReport.upsert({
                where: {
                    accountId_sessionId_key: {
                        accountId: params.userId,
                        sessionId,
                        key: params.key,
                    },
                },
                update: {
                    data: usageData,
                    updatedAt: new Date(),
                },
                create: {
                    accountId: params.userId,
                    sessionId,
                    key: params.key,
                    data: usageData,
                },
                select: {
                    id: true,
                    createdAt: true,
                    updatedAt: true,
                },
            })
            : await recordAccountLevelUsageReport(tx, {
                userId: params.userId,
                key: params.key,
                usageData,
            });

        return { ok: true, report, usageData };
    });
}

async function recordAccountLevelUsageReport(
    tx: Tx,
    params: Readonly<{
        userId: string;
        key: string;
        usageData: PrismaJson.UsageReportData;
    }>,
): Promise<UsageReportWriteSummary> {
    const existing = await tx.usageReport.findFirst({
        where: {
            accountId: params.userId,
            sessionId: null,
            key: params.key,
        },
        select: { id: true },
    });

    if (existing) {
        return await tx.usageReport.update({
            where: { id: existing.id },
            data: {
                data: params.usageData,
                updatedAt: new Date(),
            },
            select: {
                id: true,
                createdAt: true,
                updatedAt: true,
            },
        });
    }

    return await tx.usageReport.create({
        data: {
            accountId: params.userId,
            sessionId: null,
            key: params.key,
            data: params.usageData,
        },
        select: {
            id: true,
            createdAt: true,
            updatedAt: true,
        },
    });
}
