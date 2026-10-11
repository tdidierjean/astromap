// Time / label formatting helpers.

export const TZ = 'Europe/Berlin';

export function fmtTime(d: Date): string {
  return d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
}

export function fmtDateTime(d: Date): string {
  const day = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: TZ });
  return `${day}, ${fmtTime(d)}`;
}

export function nightLabel(offset: number): string {
  if (offset === 0)  return 'Tonight';
  if (offset === 1)  return 'Tomorrow';
  if (offset === -1) return 'Yesterday';
  const d = new Date(Date.now() + offset * 86_400_000);
  return d.toLocaleDateString('de-DE', { month: 'short', day: 'numeric', timeZone: TZ });
}

export function moonPhaseText(deg: number): string {
  const labels = [
    'New Moon', 'Waxing Crescent', 'First Quarter', 'Waxing Gibbous',
    'Full Moon', 'Waning Gibbous', 'Last Quarter',  'Waning Crescent',
  ];
  return labels[Math.round(deg / 45) % 8];
}
