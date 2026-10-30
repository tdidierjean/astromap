// Demo mode UI: persistent banner, entering and leaving. The demo config itself lives in config.ts (in memory only).
import { demoMode, hasStoredConfig } from './config';

/** Enter the demo: the hash selects it at load time, so set it and reload. */
export function enterDemo(): void {
  location.hash = 'demo';
  location.reload();
}

/** Leave the demo: drop the hash and reload, which loads the saved config (or starts onboarding on first run). */
export function exitDemo(): void {
  history.replaceState(null, '', location.pathname + location.search);
  location.reload();
}

export function setupDemoMode(): void {
  const link = document.getElementById('demo-link')!;
  link.addEventListener('click', e => { e.preventDefault(); enterDemo(); });
  if (!demoMode) return;
  document.getElementById('demo-link-group')!.classList.add('hidden');
  document.getElementById('demo-banner')!.classList.remove('hidden');
  // With a saved setup both buttons would do the same, so only "Exit demo" is shown.
  document.getElementById('demo-setup')!.classList.toggle('hidden', hasStoredConfig);
  document.getElementById('demo-setup')!.addEventListener('click', exitDemo);
  document.getElementById('demo-exit')!.addEventListener('click', exitDemo);
}
