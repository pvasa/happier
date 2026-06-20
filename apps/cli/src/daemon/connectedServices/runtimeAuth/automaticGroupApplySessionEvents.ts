export function shouldCommitAutomaticGroupApplySessionEvent(
  event: unknown,
  policy: Readonly<{ commitAccountSwitchEvents: boolean }>,
): boolean {
  const record = event && typeof event === 'object' ? event as Readonly<{
    type?: unknown;
    fromProfileId?: unknown;
    toProfileId?: unknown;
  }> : null;
  if (record?.type !== 'connected_service_account_switch') return true;
  const fromProfileId = typeof record.fromProfileId === 'string' ? record.fromProfileId.trim() : '';
  const toProfileId = typeof record.toProfileId === 'string' ? record.toProfileId.trim() : '';
  if (fromProfileId && toProfileId && fromProfileId === toProfileId) return false;
  return policy.commitAccountSwitchEvents;
}
