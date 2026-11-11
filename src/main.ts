// App entry: the sky view, its time model and controls, night navigation, cloud strip; Settings lives in settings.ts.
import { config, saveConfig, savedWindowIndex, saveWindowId, needsOnboarding } from './config';
import { startOnboarding } from './onboarding';
import { setupDemoMode } from './demo-mode';
import { fmtTime, fmtDateTime, fmtClock, nightLabel, addLocalDays } from './format';
import { observer, getNight, computeData, type Night, type ObjectData } from './astro';
import { state, MIN_OFFSET, MAX_OFFSET } from './state';
import { setupSettings } from './settings';
import { SkyView, compass16 } from './sky/sky';
import { leafOn, isVisible, setLeafRefDate } from './horizon';
import { twilightName } from './sky/palette';
import { registerServiceWorker } from './pwa';
import { cloudAt, forecastInfo, ensureFresh, onUpdate as onWeather } from './weather';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

let night: Night | null = null;
let data: ObjectData[] = [];
let sky: SkyView;
/** Id of the window shown in the sky view (null: none). Indices shift when windows are added, moved or deleted. */
let selWinId: string | null = null;

// Sky time: either follows the wall clock ("now" mode) or a user-chosen instant.
let nowMode = true;
let skyMs = Date.now();
let skyFrac = 0.3; // remembered position within the night, used when changing nights

// ─── Sky time ─────────────────────────────────────────────────────────────────

function setSkyTime(ms: number, fromNow = false): void {
  skyMs = ms;
  nowMode = fromNow;
  if (night) {
    const a = night.start.date.getTime(), b = night.end.date.getTime();
    if (ms >= a && ms <= b) skyFrac = (ms - a) / (b - a);
  }
  sky.setTime(ms);
  updateTimeUI();
}

function updateTimeUI(): void {
  const scrub = $<HTMLInputElement>('scrub');
  if (night) {
    const a = night.start.date.getTime(), b = night.end.date.getTime();
    const mins = Math.round((b - a) / 60000);
    scrub.max = String(mins);
    scrub.value = String(Math.min(Math.max(Math.round((skyMs - a) / 60000), 0), mins));
    $('scrub-start').textContent = `☀↓ ${fmtTime(night.start.date)}`;
    $('scrub-end').textContent = `${fmtTime(night.end.date)} ☀↑`;
  }
  $('sky-time').textContent = fmtDateTime(new Date(skyMs));
  const w = config.windows[sky.windowIndex];
  $('sky-twilight').textContent = twilightName(sky.sunAltitude) +
    (w?.profile ? ` \u00b7 trees ${leafOn(new Date(skyMs)) ? 'in leaf' : 'bare'}` : '') +
    (() => {
      const m = sky.moonStatus;
      if (!m) return '';
      return m.up ? ` \u00b7 Moon ${m.pct}% \u00b7 ${Math.round(m.alt)}\u00b0 ${compass16(m.az)}` : ` \u00b7 Moon ${m.pct}% \u00b7 down`;
    })() + cloudText(skyMs);
  $('btn-now').classList.toggle('active', nowMode);
}

// ─── Cloud forecast ───────────────────────────────────────────────────────────

/** Strip above the scrubber: x spans thumb-centre to thumb-centre, so a column's time matches the thumb position. */
function drawClouds(): void {
  const box = $('cloud-strip'), cv = $<HTMLCanvasElement>('cloud-canvas');
  const info = forecastInfo();
  const a = night?.start.date.getTime() ?? 0, b = night?.end.date.getTime() ?? 0;
  const has = !!night && !!info && [0, .25, .5, .75, 1].some(f => cloudAt(a + f * (b - a)));
  box.classList.toggle('hidden', !has);
  if (!has) return;
  $('cloud-note').textContent = info.stale ? `forecast from ${fmtTime(new Date(info.fetchedAt))}` : '';
  const dpr = window.devicePixelRatio || 1, cssW = cv.clientWidth, cssH = cv.clientHeight;
  const W = Math.round(cssW * dpr), H = Math.round(cssH * dpr);
  if (!W) return;
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d')!;
  ctx.fillStyle = '#0d1117'; ctx.fillRect(0, 0, W, H);
  for (let x = 0; x < W; x++) {
    const c = cloudAt(a + (x + 0.5) / W * (b - a));
    if (c === null) continue;
    ctx.fillStyle = `rgba(205,215,230,${(0.04 + 0.92 * Math.min(c, 100) / 100).toFixed(3)})`;
    ctx.fillRect(x, 0, 1, H);
  }
}

/** " · ☁ 35%" or " · ☁ clear" for the status line ('' without data). */
function cloudText(ms: number): string {
  const c = cloudAt(ms);
  if (c === null) return '';
  return c < 10 ? ' \u00b7 \u2601 clear' : ` \u00b7 \u2601 ${Math.round(c)}%`;
}

// ─── Refresh ──────────────────────────────────────────────────────────────────

/** @param reposition  keep the remembered fraction of the night (after changing nights) */
function refresh(reposition = false): void {
  syncSelectedWindow();
  const obs = observer();
  const refDate = new Date(addLocalDays(Date.now(), state.offsetDays));
  night = getNight(refDate, obs);
  updateNightNav();

  setLeafRefDate(night ? night.start.date : null);
  if (night) {
    data = computeData(night);
    const a = night.start.date.getTime(), b = night.end.date.getTime();
    if (nowMode) skyMs = Date.now();
    else if (reposition || skyMs < a || skyMs > b) skyMs = a + skyFrac * (b - a);
    sky.setNight(night, data);
    ensureFresh();
    sky.setTime(skyMs);
    updateTimeUI();
    drawClouds();
  }
  buildWindowPills();
}

/** Keep the sky view on the selected window by id; fall back to the first window when it is gone. */
function syncSelectedWindow(): void {
  $('sky-empty').classList.toggle('hidden', config.windows.length > 0);
  let i = config.windows.findIndex(w => w.id === selWinId);
  if (i < 0) {
    i = 0;
    selWinId = config.windows[0]?.id ?? null;
    if (selWinId) saveWindowId(selWinId);
  }
  if (config.windows.length && i !== sky.windowIndex) sky.setWindow(i);
}

// ─── Night navigation ─────────────────────────────────────────────────────────

function updateNightNav(): void {
  $('night-label').textContent = nightLabel(state.offsetDays);
  $('night-info').textContent = night ? `${fmtTime(night.start.date)} \u2192 ${fmtTime(night.end.date)}` : 'unavailable';
  $<HTMLButtonElement>('nav-prev').disabled = state.offsetDays <= MIN_OFFSET;
  $<HTMLButtonElement>('nav-next').disabled = state.offsetDays >= MAX_OFFSET;
}

function setupNightNav(): void {
  $('nav-prev').addEventListener('click', () => {
    if (state.offsetDays > MIN_OFFSET) { state.offsetDays--; nowMode = false; refresh(true); }
  });
  $('nav-next').addEventListener('click', () => {
    if (state.offsetDays < MAX_OFFSET) { state.offsetDays++; nowMode = false; refresh(true); }
  });
}

// ─── Sky controls ─────────────────────────────────────────────────────────────

function buildWindowPills(): void {
  const box = $('window-pills');
  box.innerHTML = '';
  config.windows.forEach((w, i) => {
    const b = document.createElement('button');
    b.className = 'pill' + (i === sky.windowIndex ? ' active' : '');
    b.textContent = w.label;
    b.addEventListener('click', () => {
      selWinId = w.id; sky.setWindow(i); buildWindowPills(); updateTimeUI();
      saveWindowId(w.id);
    });
    box.appendChild(b);
  });
}

function setupSkyControls(): void {
  $('scrub').addEventListener('input', e => {
    if (!night) return;
    const v = Number((e.target as HTMLInputElement).value);
    setSkyTime(night.start.date.getTime() + v * 60000);
  });

  $('btn-now').addEventListener('click', () => {
    nowMode = true;
    if (state.offsetDays !== 0) { state.offsetDays = 0; refresh(); }
    setSkyTime(Date.now(), true);
  });

  $('btn-reset').addEventListener('click', () => sky.resetView());
  const magBtn = $('btn-mag'), magPop = $('mag-pop');
  magBtn.addEventListener('click', () => {
    const open = magPop.classList.toggle('hidden') === false;
    magBtn.classList.toggle('active', open);
    magBtn.setAttribute('aria-expanded', String(open));
  });

  const grid = $('btn-grid');
  const syncGrid = () => grid.classList.toggle('active', config.showGrid);
  syncGrid();
  grid.addEventListener('click', () => { config.showGrid = !config.showGrid; saveConfig(); syncGrid(); sky.requestRender(); });

  const lim = $<HTMLInputElement>('lim-mag');
  lim.value = String(config.limitMag);
  $('lim-mag-val').textContent = config.limitMag.toFixed(1);
  lim.addEventListener('input', () => {
    config.limitMag = Number(lim.value);
    $('lim-mag-val').textContent = config.limitMag.toFixed(1);
    saveConfig();
    sky.requestRender();
  });
}

function updateClock(): void {
  $('clock').textContent = fmtClock(new Date());
}

window.addEventListener('load', () => {
  setupDemoMode();
  // First run: the overlay saves the config and reloads; nothing else is started (no forecast fetch for a placeholder location).
  if (needsOnboarding) { startOnboarding(); return; }
  sky = new SkyView($<HTMLCanvasElement>('sky'), $('sky-stage'), $('sky-info'));
  selWinId = config.windows[savedWindowIndex()]?.id ?? null;
  syncSelectedWindow();

  setupSettings(() => { refresh(); }, id => { if (id === selWinId) sky.resetView(); });
  setupNightNav();
  setupSkyControls();
  onWeather(() => { drawClouds(); updateTimeUI(); });
  refresh();
  updateClock();
  setInterval(() => refresh(), 60_000);
  setInterval(updateClock, 1_000);
  setInterval(() => { if (nowMode) setSkyTime(Date.now(), true); }, 30_000);

  // Test/debug hook
  (window as any).__astromap = {
    sky, config, setLeafRef: (ms: number | null) => { setLeafRefDate(ms == null ? null : new Date(ms)); sky.settingsChanged(); updateTimeUI(); },
    isVisible: (w: number, az: number, alt: number, ms: number) => isVisible(config.windows[w], az, alt, new Date(ms)),
    setTime: (ms: number) => setSkyTime(ms),
    setWindow: (i: number) => { selWinId = config.windows[i]?.id ?? null; sky.setWindow(i); buildWindowPills(); },
  };
});

window.addEventListener('resize', drawClouds);

registerServiceWorker();
