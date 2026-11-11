// Settings sheet: opened from the header gear. Location, clock, windows, leaf season, min altitude, backup, credits.
import { config, saveConfig, deviceTz, demoMode, isValidTz, type LeafMode, type ClockMode } from './config';
import { locationLabel, formatCoords } from './location';
import { parseMonthDay, defaultLeafSeason, defaultSeasonText, NORTH_LEAF, SOUTH_LEAF } from './leaf';
import { renderWindowList, setupWindowList, addImportedWindow } from './settings-windows';
import { parseTransfer, serializeConfig, configFilename, withFreshId } from './transfer';
import { exportFile, readImportFile } from './transfer-ui';

/** Header label: place name (set as text, so it needs no escaping) or coordinates. */
function updateLocationLabel(): void {
  document.getElementById('location-label')!.textContent = locationLabel(config);
  document.getElementById('coord-label')!.textContent = formatCoords(config.lat, config.lon);
  syncLeafUI();
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Effective "MM-DD" start/end: the override, else the latitude's default (north or south dates in the tropics). */
function leafDates(): { start: string; end: string } {
  const d = defaultLeafSeason(config.lat) ?? (config.lat < 0 ? SOUTH_LEAF : NORTH_LEAF);
  return {
    start: parseMonthDay(config.leafStart) !== null ? config.leafStart! : d.start,
    end: parseMonthDay(config.leafEnd) !== null ? config.leafEnd! : d.end,
  };
}

/** Leaf-season controls: only shown for mode Auto; month/day selects show the effective dates. */
function syncLeafUI(): void {
  const box = document.getElementById('leaf-season');
  if (!box) return;
  box.classList.toggle('hidden', config.leaf !== 'auto');
  const fill = (mId: string, dId: string, md: string) => {
    const m = document.getElementById(mId) as HTMLSelectElement, d = document.getElementById(dId) as HTMLSelectElement;
    if (!m.options.length) MONTH_NAMES.forEach((n, i) => m.add(new Option(n, String(i + 1))));
    if (!d.options.length) for (let i = 1; i <= 31; i++) d.add(new Option(String(i), String(i)));
    m.value = String(Number(md.slice(0, 2))); d.value = String(Number(md.slice(3)));
  };
  const { start, end } = leafDates();
  fill('leaf-start-m', 'leaf-start-d', start);
  fill('leaf-end-m', 'leaf-end-d', end);
  const custom = config.leafStart !== undefined || config.leafEnd !== undefined;
  (document.getElementById('leaf-default') as HTMLButtonElement).disabled = !custom;
  document.getElementById('leaf-season-hint')!.textContent =
    `${custom ? 'Custom dates. ' : ''}Default for ${formatCoords(config.lat, config.lon)}: ${defaultSeasonText(config.lat)}`;
}

function syncUI(): void {
  const set = (id: string, v: string) => ((document.getElementById(id) as HTMLInputElement).value = v);
  set('min-alt', String(config.minAlt));
  set('lat', String(config.lat));
  set('lon', String(config.lon));
  set('loc-name', config.name);
  updateLocationLabel();
  set('leaf-mode', config.leaf);
  syncLeafUI();
  syncTzUI();
  set('clock-mode', config.clock);
  document.getElementById('min-alt-val')!.textContent = `${config.minAlt}\u00b0`;
  renderWindowList();
}

/** Fill the zone list (once) and select the configured zone; falls back to a text input without Intl.supportedValuesOf. */
function syncTzUI(): void {
  const sel = document.getElementById('tz-select') as HTMLSelectElement;
  const txt = document.getElementById('tz-text') as HTMLInputElement;
  let zones: string[] = [];
  try { zones = (Intl as any).supportedValuesOf?.('timeZone') ?? []; } catch { /* unsupported */ }
  if (!zones.length) {
    sel.classList.add('hidden'); txt.classList.remove('hidden'); txt.value = config.tz;
    return;
  }
  txt.classList.add('hidden'); sel.classList.remove('hidden');
  if (!zones.includes(config.tz)) zones = [config.tz, ...zones];
  if (!zones.includes('UTC')) zones.push('UTC');
  sel.innerHTML = '';
  for (const z of zones) {
    const o = document.createElement('option');
    o.value = z; o.textContent = z.replace(/_/g, ' ');
    sel.appendChild(o);
  }
  sel.value = config.tz;
}

/** Export / import of the whole config or a single window (file format: transfer.ts). */
function setupTransfer(refresh: () => void, say: (text: string, err?: boolean) => void): void {
  const input = document.getElementById('import-file') as HTMLInputElement;
  document.getElementById('export-config')!.addEventListener('click', () => {
    void exportFile(configFilename(config), serializeConfig(config)).then(m => say(m));
  });
  document.getElementById('import-btn')!.addEventListener('click', () => input.click());
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    input.value = ''; // picking the same file again must fire `change` again
    if (!file) return;
    const text = await readImportFile(file).catch(() => null);
    const r = text === null ? null : parseTransfer(text);
    if (!r) { say('Could not read that file (too large or unreadable).', true); return; }
    if (!r.ok) { say(r.error, true); return; }
    if (r.kind === 'window') {
      addImportedWindow(withFreshId(r.window, config.windows));
      say(`Added window "${r.window.label}".`);
      return;
    }
    const n = r.config.windows.length;
    if (!confirm(`Replace your place and all ${config.windows.length} window${config.windows.length === 1 ? '' : 's'} with the imported settings (${n} window${n === 1 ? '' : 's'})?`)) return;
    // In demo mode this stays in memory: saveConfig is a no-op there and the banner still says nothing is saved.
    Object.assign(config, r.config);
    saveConfig(); syncUI(); refresh();
    say(demoMode ? 'Imported for this demo session only (not saved).' : `Imported ${locationLabel(config)} with ${n} window${n === 1 ? '' : 's'}.`);
  });
}

export function setupSettings(refresh: () => void, recentre: (id: string) => void): void {
  syncUI();
  const msg = document.getElementById('transfer-msg')!;
  const say = (text: string, err = false) => { msg.textContent = text; msg.classList.toggle('settings-msg--err', err); };
  setupWindowList(refresh, recentre, say);
  setupTransfer(refresh, say);

  const on = (id: string, fn: (v: number) => void) => {
    document.getElementById(id)!.addEventListener('input', e => {
      fn(Number((e.target as HTMLInputElement).value));
      saveConfig();
      refresh();
    });
  };

  document.getElementById('leaf-mode')!.addEventListener('change', e => {
    config.leaf = (e.target as HTMLSelectElement).value as LeafMode;
    saveConfig(); syncLeafUI(); refresh();
  });
  const setLeaf = () => {
    const v = (id: string) => (document.getElementById(id) as HTMLSelectElement).value.padStart(2, '0');
    const start = `${v('leaf-start-m')}-${v('leaf-start-d')}`, end = `${v('leaf-end-m')}-${v('leaf-end-d')}`;
    if (parseMonthDay(start) === null || parseMonthDay(end) === null) { syncLeafUI(); return; } // e.g. 31 Apr
    config.leafStart = start; config.leafEnd = end;
    saveConfig(); syncLeafUI(); refresh();
  };
  for (const id of ['leaf-start-m', 'leaf-start-d', 'leaf-end-m', 'leaf-end-d']) document.getElementById(id)!.addEventListener('change', setLeaf);
  document.getElementById('leaf-default')!.addEventListener('click', () => {
    delete config.leafStart; delete config.leafEnd;
    saveConfig(); syncLeafUI(); refresh();
  });
  const setTz = (tz: string) => {
    if (!isValidTz(tz)) { syncTzUI(); return; }
    config.tz = tz; saveConfig(); syncTzUI(); refresh();
  };
  document.getElementById('tz-select')!.addEventListener('change', e => setTz((e.target as HTMLSelectElement).value));
  document.getElementById('tz-text')!.addEventListener('change', e => setTz((e.target as HTMLInputElement).value.trim()));
  document.getElementById('tz-device')!.addEventListener('click', () => setTz(deviceTz()));
  document.getElementById('clock-mode')!.addEventListener('change', e => {
    config.clock = (e.target as HTMLSelectElement).value as ClockMode;
    saveConfig(); refresh();
  });
  on('min-alt', v => { config.minAlt = v; document.getElementById('min-alt-val')!.textContent = `${v}\u00b0`; });

  document.getElementById('loc-name')!.addEventListener('change', e => {
    config.name = (e.target as HTMLInputElement).value.trim();
    updateLocationLabel();
    saveConfig();
  });

  // Lat/lon on change (not input) to avoid partial-number triggers
  ['lat', 'lon'].forEach(id =>
    document.getElementById(id)!.addEventListener('change', e => {
      const v = Number((e.target as HTMLInputElement).value);
      if (isNaN(v)) return;
      if (id === 'lat') config.lat = v;
      else              config.lon = v;
      updateLocationLabel();
      saveConfig();
      refresh();
    })
  );

  setupSheet();
}

/** Full-screen sheet: gear opens, Done / Escape closes (Escape is left to the horizon editor while it is open). */
function setupSheet(): void {
  const sheet = document.getElementById('settings')!, gear = document.getElementById('settings-open')!;
  const open = () => {
    sheet.classList.remove('hidden'); document.body.classList.add('sheet-open');
    gear.setAttribute('aria-expanded', 'true'); sheet.querySelector<HTMLElement>('.sheet__body')!.scrollTop = 0;
    (sheet.querySelector('#settings-close') as HTMLElement).focus({ preventScroll: true });
  };
  const close = () => {
    sheet.classList.add('hidden'); document.body.classList.remove('sheet-open');
    gear.setAttribute('aria-expanded', 'false'); gear.focus({ preventScroll: true });
  };
  gear.addEventListener('click', open);
  document.getElementById('settings-close')!.addEventListener('click', close);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !sheet.classList.contains('hidden') && !document.body.classList.contains('hz-open')) close();
  });
}
