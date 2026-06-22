export function isBackgroundConnectedServiceSwitchReason(reason: string | null | undefined): boolean {
  const normalized = typeof reason === 'string' ? reason.trim() : '';
  return normalized === 'soft_threshold'
    || normalized === 'same_provider_account_exhausted';
}
