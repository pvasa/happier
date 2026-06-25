import { describe, expect, it } from 'vitest';

import { ConnectedServiceQuotaRecoveryCreditsV1Schema } from '@happier-dev/protocol';

import { buildQuotaResetRows } from './buildQuotaResetRows';
import type { ResetCountdownDaysFormatter } from './formatResetCountdown';

const formatter: ResetCountdownDaysFormatter = {
    now: () => 'now',
    inDays: ({ days }) => `in ${days}d`,
};

const DAY = 24 * 60 * 60 * 1000;
const NOW = 100 * DAY;

describe('buildQuotaResetRows', () => {
    it('returns no rows when there are no available credits', () => {
        expect(buildQuotaResetRows(null, NOW, formatter)).toEqual([]);
        expect(buildQuotaResetRows(undefined, NOW, formatter)).toEqual([]);
        expect(
            buildQuotaResetRows(
                ConnectedServiceQuotaRecoveryCreditsV1Schema.parse({
                    kind: 'usage_limit_resets',
                    availableCount: 0,
                    credits: [],
                }),
                NOW,
                formatter,
            ),
        ).toEqual([]);
    });

    it('builds one aggregate placeholder row when credits are empty but the count is positive', () => {
        const rows = buildQuotaResetRows(
            ConnectedServiceQuotaRecoveryCreditsV1Schema.parse({
                kind: 'usage_limit_resets',
                availableCount: 2,
                nextExpiresAtMs: NOW + 2 * DAY,
                credits: [],
            }),
            NOW,
            formatter,
        );
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            consumableCreditId: null,
            canUse: true,
            isAggregate: true,
            expiresAtMs: NOW + 2 * DAY,
            countdownLabel: 'in 2d',
        });
        expect(rows[0]?.key).toBeTruthy();
    });

    it('builds per-credit rows keyed and gated on providerCreditId', () => {
        const rows = buildQuotaResetRows(
            ConnectedServiceQuotaRecoveryCreditsV1Schema.parse({
                kind: 'usage_limit_resets',
                availableCount: 2,
                credits: [
                    { kind: 'usage_limit_reset', status: 'available', providerCreditId: 'credit-a', expiresAtMs: NOW + DAY },
                    { kind: 'usage_limit_reset', status: 'available', providerCreditId: 'credit-b', expiresAtMs: NOW + 3 * DAY },
                ],
            }),
            NOW,
            formatter,
        );
        expect(rows).toHaveLength(2);
        expect(rows[0]).toMatchObject({
            key: 'credit-a',
            consumableCreditId: 'credit-a',
            canUse: true,
            isAggregate: false,
            countdownLabel: 'in 1d',
        });
        expect(rows[1]).toMatchObject({ key: 'credit-b', consumableCreditId: 'credit-b', canUse: true, countdownLabel: 'in 3d' });
    });

    it('filters out redeemed and expired credits', () => {
        const rows = buildQuotaResetRows(
            ConnectedServiceQuotaRecoveryCreditsV1Schema.parse({
                kind: 'usage_limit_resets',
                availableCount: 3,
                credits: [
                    { kind: 'usage_limit_reset', status: 'redeemed', providerCreditId: 'gone', expiresAtMs: NOW + DAY },
                    { kind: 'usage_limit_reset', status: 'available', providerCreditId: 'expired', expiresAtMs: NOW - DAY },
                    { kind: 'usage_limit_reset', status: 'available', providerCreditId: 'live', expiresAtMs: NOW + DAY },
                ],
            }),
            NOW,
            formatter,
        );
        expect(rows.map((row) => row.consumableCreditId)).toEqual(['live']);
    });

    it('disables Use for available credits that lack a provider credit id', () => {
        const rows = buildQuotaResetRows(
            ConnectedServiceQuotaRecoveryCreditsV1Schema.parse({
                kind: 'usage_limit_resets',
                availableCount: 1,
                credits: [{ kind: 'usage_limit_reset', status: 'available', expiresAtMs: NOW + DAY }],
            }),
            NOW,
            formatter,
        );
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ key: '0', consumableCreditId: null, canUse: false, isAggregate: false });
    });

    it('returns no rows when every detailed credit is unavailable', () => {
        const rows = buildQuotaResetRows(
            ConnectedServiceQuotaRecoveryCreditsV1Schema.parse({
                kind: 'usage_limit_resets',
                availableCount: 1,
                credits: [{ kind: 'usage_limit_reset', status: 'redeemed', providerCreditId: 'gone' }],
            }),
            NOW,
            formatter,
        );
        expect(rows).toEqual([]);
    });
});
