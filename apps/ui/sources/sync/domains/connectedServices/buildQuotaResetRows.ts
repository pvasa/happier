import type {
    ConnectedServiceQuotaRecoveryCreditV1,
    ConnectedServiceQuotaRecoveryCreditsV1,
} from '@happier-dev/protocol';

import { formatResetCountdownDays, type ResetCountdownDaysFormatter } from './formatResetCountdown';

export type QuotaResetRow = Readonly<{
    /** Stable React key — `providerCreditId` when present, else the row index. */
    key: string;
    /** Provider credit id to consume, or `null` for the aggregate fallback. */
    consumableCreditId: string | null;
    /** Whether the `Use` action is permitted (has an id, or is the aggregate). */
    canUse: boolean;
    /** True for the single placeholder row when only an available count is known. */
    isAggregate: boolean;
    expiresAtMs: number | null;
    countdownLabel: string | null;
}>;

function readProviderCreditId(credit: ConnectedServiceQuotaRecoveryCreditV1): string | null {
    const raw = typeof credit.providerCreditId === 'string' ? credit.providerCreditId.trim() : '';
    return raw.length > 0 ? raw : null;
}

function isAvailableCredit(credit: ConnectedServiceQuotaRecoveryCreditV1, nowMs: number): boolean {
    if (credit.status !== 'available') return false;
    if (typeof credit.expiresAtMs !== 'number' || !Number.isFinite(credit.expiresAtMs)) return true;
    return credit.expiresAtMs > nowMs;
}

function normalizeFutureExpiry(expiresAtMs: number | null | undefined, nowMs: number): number | null {
    if (typeof expiresAtMs !== 'number' || !Number.isFinite(expiresAtMs)) return null;
    return expiresAtMs > nowMs ? expiresAtMs : null;
}

/**
 * Build per-credit QUOTA RESETS rows from a recovery-credit summary.
 *
 * - No available count ⇒ no rows.
 * - Empty `credits[]` + positive `availableCount` ⇒ one aggregate placeholder
 *   row (`consumableCreditId: null`, `canUse: true`) consumed via the summary.
 * - Detailed credits ⇒ one row per AVAILABLE (future-expiry) credit. The `Use`
 *   action is gated on a real `providerCreditId`; rows without one are shown but
 *   not individually consumable.
 */
export function buildQuotaResetRows(
    recoveryCredits: ConnectedServiceQuotaRecoveryCreditsV1 | null | undefined,
    nowMs: number,
    formatter: ResetCountdownDaysFormatter,
): QuotaResetRow[] {
    if (!recoveryCredits || recoveryCredits.availableCount <= 0) return [];

    const detailedCredits = Array.isArray(recoveryCredits.credits) ? recoveryCredits.credits : [];

    if (detailedCredits.length === 0) {
        const expiresAtMs = normalizeFutureExpiry(recoveryCredits.nextExpiresAtMs, nowMs);
        return [{
            key: 'aggregate',
            consumableCreditId: null,
            canUse: true,
            isAggregate: true,
            expiresAtMs,
            countdownLabel: formatResetCountdownDays(nowMs, expiresAtMs, formatter),
        }];
    }

    const availableCredits = detailedCredits.filter((credit) => isAvailableCredit(credit, nowMs));
    if (availableCredits.length === 0) return [];

    return availableCredits.map((credit, index) => {
        const consumableCreditId = readProviderCreditId(credit);
        const expiresAtMs = normalizeFutureExpiry(credit.expiresAtMs, nowMs);
        return {
            key: consumableCreditId ?? String(index),
            consumableCreditId,
            canUse: consumableCreditId !== null,
            isAggregate: false,
            expiresAtMs,
            countdownLabel: formatResetCountdownDays(nowMs, expiresAtMs, formatter),
        };
    });
}
