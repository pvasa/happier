export type DoctorCleanupOwnershipSummary = Readonly<{
  title: string;
  lines: readonly string[];
}>;

export function renderDoctorCleanupOwnershipSummary(params: Readonly<{
  ownerLabel: string;
  serviceManaged: boolean | null;
}>): DoctorCleanupOwnershipSummary | null {
  const ownerLabel = params.ownerLabel.trim();
  if (!ownerLabel) {
    return null;
  }

  const lines = [
    `Current owner: ${ownerLabel}`,
    'This cleanup guidance does not switch relay ownership.',
  ];

  if (params.serviceManaged === true) {
    lines.push('Use `happier service restart` if you want automatic startup to switch to this installation.');
  } else if (params.serviceManaged === false) {
    lines.push('Use `happier daemon restart` if you want the manual relay runtime to switch to this installation.');
  } else {
    lines.push('Restart the current relay owner before trying to switch this installation.');
  }

  return {
    title: 'Cleanup ownership summary',
    lines,
  };
}
