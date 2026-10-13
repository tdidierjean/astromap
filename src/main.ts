// App entry: wires the planner (Plan tab) and the sky view (Sky tab) together.
import * as Astronomy from 'astronomy-engine';
import { config, saveConfig } from './config';
import { TZ, fmtTime, fmtDateTime } from './format';
import { OBJECTS, observer, getNight, computeData, updateCurrent, type Night, type ObjectData } from './astro';
import { state } from './state';
import {
  renderCards, renderTimeline, renderPanorama, updateNightNav, setupNightNav, setupSettings, setupTimelinePick,
} from './planner';
import { SkyView, compass16 } from './sky/sky';
import { leafOn, isVisible, setLeafRefDate } from './horizon';
import { twilightName } from './sky/palette';
import { registerServiceWorker } from './pwa';

// Inject object dot styles into <head> once
(function injectDotStyles() {
  const style = document.createElement('style');
  style.textContent = OBJECTS.map(o => `.${o.dotClass} { background: ${o.color}; }`).join(' ');
  document.head.appendChild(style);
})();

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

let night: Night | null = null;
let data: ObjectData[] = [];
let sky: SkyView;

// Sky time: either follows the wall clock ("now" mode) or a user-chosen instant.
let nowMode = true;
let picked = false; // the user has chosen a time (scrubber, timeline tap or time field)
let skyMs = Date.now();
let skyFrac = 0.3; // remembered position within the night, used when changing nights
let activeTab: 'sky' | 'plan' = 'sky';

// ─── Sky time ─────────────────────────────────────────────────────────────────

function setSkyTime(ms: number, fromNow = false): void {
  skyMs = ms;
  nowMode = fromNow;
  picked = !fromNow;
  if (night) {
    const a = night.start.date.getTime(), b = night.end.date.getTime();
    if (ms >= a && ms <= b) skyFrac = (ms - a) / (b - a);
  }
  sky.setTime(ms);
  updateTimeUI();
  if (activeTab === 'plan' && night) { updateCurrent(data, Astronomy.MakeTime(new Date(skyMs))); renderPlan(); }
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
    })();
  $('btn-now').classList.toggle('active', nowMode);
  const tp = $<HTMLInputElement>('time-picker');
  if (document.activeElement !== tp) {
    const d = new Date(skyMs);
    tp.value = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
}

// ─── Refresh ──────────────────────────────────────────────────────────────────

/** @param reposition  keep the remembered fraction of the night (after changing nights) */
function refresh(reposition = false): void {
  const obs = observer();
  const refDate = new Date(Date.now() + state.offsetDays * 86_400_000);
  night = getNight(refDate, obs);
  updateNightNav(night);

  setLeafRefDate(night ? night.start.date : null);
  if (night) {
    data = computeData(night, Astronomy.MakeTime(new Date()));
    const a = night.start.date.getTime(), b = night.end.date.getTime();
    if (nowMode) skyMs = Date.now();
    else if (reposition || skyMs < a || skyMs > b) skyMs = a + skyFrac * (b - a);
    sky.setNight(night, data);
    updateCurrent(data, Astronomy.MakeTime(new Date(skyMs)));
    sky.setTime(skyMs);
    updateTimeUI();
    if (activeTab === 'plan') renderPlan();
  }
  buildWindowPills();
}

function renderPlan(): void {
  if (!night) return;
  const isCurrent = state.offsetDays === 0;
  renderCards(data, skyMs, nowMode, nowMode || picked);
  renderTimeline(data, night, isCurrent, skyMs);
  renderPanorama(data, isCurrent, new Date(skyMs));
}

// ─── Tabs & sky controls ──────────────────────────────────────────────────────

function showTab(tab: 'sky' | 'plan'): void {
  activeTab = tab;
  document.body.dataset.tab = tab;
  $('view-sky').classList.toggle('hidden', tab !== 'sky');
  $('view-plan').classList.toggle('hidden', tab !== 'plan');
  document.querySelectorAll<HTMLButtonElement>('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  if (tab === 'plan') renderPlan(); else sky.requestRender();
}

function buildWindowPills(): void {
  const box = $('window-pills');
  box.innerHTML = '';
  config.windows.forEach((w, i) => {
    const b = document.createElement('button');
    b.className = 'pill' + (i === sky.windowIndex ? ' active' : '');
    b.textContent = w.label;
    b.addEventListener('click', () => {
      sky.setWindow(i); buildWindowPills(); updateTimeUI();
      try { localStorage.setItem('astromap-window', String(i)); } catch { /* ignore */ }
    });
    box.appendChild(b);
  });
}

function setupSkyControls(): void {
  document.querySelectorAll<HTMLButtonElement>('.tab').forEach(b =>
    b.addEventListener('click', () => showTab(b.dataset.tab as 'sky' | 'plan')));

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

  setupTimelinePick(ms => { setSkyTime(ms); });

  // Plan-tab time field: same shared state as the scrubber. Picks the matching clock time inside the shown night.
  $<HTMLInputElement>('time-picker').addEventListener('input', e => {
    if (!night) return;
    const [h, m] = (e.target as HTMLInputElement).value.split(':').map(Number);
    if (Number.isNaN(h) || Number.isNaN(m)) return;
    const a = night.start.date.getTime(), b = night.end.date.getTime();
    const cands = [0, 1].map(k => { const d = new Date(a); d.setDate(d.getDate() + k); d.setHours(h, m, 0, 0); return d.getTime(); });
    const hit = cands.find(t => t >= a && t <= b) ?? (Math.abs(cands[0] - a) < Math.abs(cands[1] - a) ? cands[0] : cands[1]);
    setSkyTime(Math.min(Math.max(hit, a), b));
  });
  $('time-now').addEventListener('click', () => $('btn-now').click());
}

function updateClock(): void {
  $('clock').textContent = new Date().toLocaleTimeString('de-DE', {
    timeZone: TZ, hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

window.addEventListener('load', () => {
  sky = new SkyView($<HTMLCanvasElement>('sky'), $('sky-stage'), $('sky-info'));
  const saved = Number(localStorage.getItem('astromap-window'));
  if (saved > 0 && saved < config.windows.length) sky.setWindow(saved);

  setupSettings(() => { refresh(); });
  setupNightNav(() => { nowMode = false; refresh(true); });
  setupSkyControls();
  showTab('sky');
  refresh();
  updateClock();
  setInterval(() => refresh(), 60_000);
  setInterval(updateClock, 1_000);
  setInterval(() => { if (nowMode) setSkyTime(Date.now(), true); }, 30_000);

  // Test/debug hook
  (window as any).__astromap = {
    sky, showTab, config, setLeafRef: (ms: number | null) => { setLeafRefDate(ms == null ? null : new Date(ms)); sky.settingsChanged(); updateTimeUI(); },
    isVisible: (w: number, az: number, alt: number, ms: number) => isVisible(config.windows[w], az, alt, new Date(ms)),
    setTime: (ms: number) => setSkyTime(ms),
    setWindow: (i: number) => { sky.setWindow(i); buildWindowPills(); },
  };
});

window.addEventListener('resize', () => { if (activeTab === 'plan') renderPlan(); });

registerServiceWorker();
