export type PendingMaterializationActiveTurnPolicy = 'block' | 'allow_live_delivery';

export function normalizePendingMaterializationActiveTurnPolicy(
  value: PendingMaterializationActiveTurnPolicy | undefined,
): PendingMaterializationActiveTurnPolicy {
  return value === 'allow_live_delivery' ? 'allow_live_delivery' : 'block';
}

export function blocksPendingMaterializationDuringActiveTurn(
  value: PendingMaterializationActiveTurnPolicy | undefined,
): boolean {
  return normalizePendingMaterializationActiveTurnPolicy(value) !== 'allow_live_delivery';
}
