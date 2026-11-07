/**
 * ADDON-41 rule 7 (white-label): customers see Octopus service names only — never the carrier behind them.
 * Staff screens may show carriers; customer pages, the customer API and the Octo assistant use these names.
 */
export const SERVICE_NAMES = ['Express', 'Standard', 'Economy', 'DDP Gulf', 'DDP US', 'DDP UK'] as const;

export function serviceName(code: string | null | undefined): string {
  const c = (code ?? '').toLowerCase();
  if (/ddp[_\s-]*(gulf|gcc|ae|sa)/.test(c)) return 'DDP Gulf';
  if (/ddp[_\s-]*(us|usa)/.test(c)) return 'DDP US';
  if (/ddp[_\s-]*(uk|gb)/.test(c)) return 'DDP UK';
  if (/express|priority|air/.test(c)) return 'Express';
  if (/econom|sea|slow/.test(c)) return 'Economy';
  return 'Standard';
}
