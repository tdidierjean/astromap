// Planner UI: visibility cards, Gantt timeline, az/alt panorama, night navigation, settings.
import * as Astronomy from 'astronomy-engine';
import { config, saveConfig } from './config';
import { fmtTime, nightLabel, moonPhaseText } from './format';
import { findVisSpans, type ObjectData, type Night } from './astro';
import { state, MIN_OFFSET, MAX_OFFSET } from './state';

// ─── Render: cards ────────────────────────────────────────────────────────────

export function renderCards(data: ObjectData[]): void {
  const isCurrent = state.offsetDays === 0;
  const phaseRefTime = isCurrent
    ? Astronomy.MakeTime(new Date())
    : Astronomy.MakeTime(new Date(Date.now() + state.offsetDays * 86_400_000));
  const phase    = Astronomy.MoonPhase(phaseRefTime);
  const phaseStr = moonPhaseText(phase);
  const nowMs    = Date.now();

  document.getElementById('cards')!.innerHTML = data.map(obj => {
    const spans  = findVisSpans(obj.samples);
    const hasAny = spans.length > 0;

    // For tonight: find the first span that hasn't ended yet.
    // For future/past nights: just show the first span (all are equally "upcoming" or past).
    const primary = isCurrent
      ? spans.find(s => s.end.getTime() > nowMs)
      : spans[0];

    let windowStr = '—';
    let dirStr    = '';
    if (primary) {
      const inProgress = isCurrent && primary.start.getTime() <= nowMs;
      windowStr = inProgress
        ? `Now &ndash; ${fmtTime(primary.end)}`
        : `${fmtTime(primary.start)} &ndash; ${fmtTime(primary.end)}`;
      dirStr = primary.direction;
    }

    // For tonight: show current live position.
    // For other nights: show position at night midpoint, labelled.
    const posStr = isCurrent
      ? (obj.curAlt > -1
          ? `Alt&nbsp;${obj.curAlt.toFixed(0)}&deg;&nbsp;&middot;&nbsp;Az&nbsp;${obj.curAz.toFixed(0)}&deg;`
          : 'Below horizon')
      : `~Midnight:&nbsp;Alt&nbsp;${obj.curAlt.toFixed(0)}&deg;&nbsp;&middot;&nbsp;Az&nbsp;${obj.curAz.toFixed(0)}&deg;`;

    // Show remaining spans after the primary one
    const rest = primary ? spans.filter(s => s !== primary) : spans.slice(1);
    const extras = rest.length > 0
      ? rest.map(s => `<div class="card__extra">also ${fmtTime(s.start)}&ndash;${fmtTime(s.end)} (${s.direction})</div>`).join('')
      : '';

    const phaseInfo = obj.name === 'Moon'
      ? `<div class="card__phase">${phaseStr} &middot; ${phase.toFixed(0)}&deg;</div>`
      : '';

    return `
      <div class="card ${hasAny ? 'card--visible' : 'card--blocked'}">
        <div class="card__header">
          <span class="card__dot ${obj.dotClass}"></span>
          <span class="card__name">${obj.name}</span>
          <span class="card__status ${hasAny ? 'status--yes' : 'status--no'}">${hasAny ? 'VISIBLE' : 'BLOCKED'}</span>
        </div>
        <div class="card__window">${windowStr}${dirStr ? ` <span class="card__dir">(${dirStr})</span>` : ''}</div>
        <div class="card__pos">${posStr}</div>
        ${phaseInfo}
        ${extras}
      </div>
    `;
  }).join('');
}

// ─── Render: timeline canvas ──────────────────────────────────────────────────

let tlGeom: { PL: number; PR: number; t0: number; t1: number } | null = null;

export function renderTimeline(data: ObjectData[], night: Night, isCurrent = false, skyMs?: number): void {
  const canvas = document.getElementById('timeline') as HTMLCanvasElement;
  const ctx    = canvas.getContext('2d')!;
  const dpr    = window.devicePixelRatio || 1;
  const W      = canvas.clientWidth;
  const H      = canvas.clientHeight;
  if (W === 0 || H === 0) return;

  canvas.width  = W * dpr;
  canvas.height = H * dpr;
  ctx.scale(dpr, dpr);

  const PL = 68, PR = 12, PT = 28, PB = 28;
  const rows  = data.length;
  const rowH  = (H - PT - PB) / rows;
  const barH  = rowH * 0.44;
  const barY  = (i: number) => PT + i * rowH + (rowH - barH) / 2;

  const t0   = night.start.date.getTime();
  const t1   = night.end.date.getTime();
  const span = t1 - t0;
  const toX  = (ms: number) => PL + ((ms - t0) / span) * (W - PL - PR);
  tlGeom = { PL, PR, t0, t1 };

  // Background
  ctx.fillStyle = '#161b22';
  ctx.fillRect(0, 0, W, H);

  // Hourly grid lines + labels
  ctx.strokeStyle = '#21262d';
  ctx.lineWidth   = 1;

  const firstHour = new Date(t0);
  firstHour.setMinutes(0, 0, 0);
  firstHour.setTime(firstHour.getTime() + 3_600_000);

  const fontSize = Math.min(11, Math.max(9, W / 70));
  ctx.font      = `${fontSize}px monospace`;
  ctx.fillStyle = '#4a5568';
  ctx.textAlign = 'center';

  for (let t = firstHour.getTime(); t < t1; t += 3_600_000) {
    const x = toX(t);
    ctx.beginPath();
    ctx.moveTo(x, PT);
    ctx.lineTo(x, H - PB);
    ctx.stroke();
    ctx.fillText(fmtTime(new Date(t)), x, H - PB + 14);
  }

  // Object rows
  data.forEach((obj, i) => {
    const y = barY(i);

    // Row label
    ctx.fillStyle = '#8b949e';
    ctx.font      = '12px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(obj.name, PL - 8, y + barH / 2 + 4);

    // Base bar (full night span)
    ctx.fillStyle = '#0d1117';
    ctx.fillRect(PL, y, W - PL - PR, barH);

    // Altitude curve (faint backdrop)
    ctx.beginPath();
    ctx.strokeStyle = obj.color + '22';
    ctx.lineWidth   = 1.5;
    let penUp = true;
    for (const s of obj.samples) {
      const x    = toX(s.time.date.getTime());
      const frac = Math.min(Math.max(s.altitude, 0) / 80, 1);
      const sy   = y + barH - frac * barH;
      if (s.altitude > 0) {
        if (penUp) { ctx.moveTo(x, sy); penUp = false; }
        else       ctx.lineTo(x, sy);
      } else {
        penUp = true;
      }
    }
    ctx.stroke();

    // Visibility segments
    ctx.lineWidth = 0;
    for (let s = 0; s < obj.samples.length - 1; s++) {
      const cur  = obj.samples[s];
      const next = obj.samples[s + 1];
      const x1   = toX(cur.time.date.getTime());
      const x2   = toX(next.time.date.getTime());
      const w    = Math.max(x2 - x1, 1);

      if (cur.visible) {
        ctx.fillStyle = obj.color;
      } else if (cur.altitude > 0) {
        ctx.fillStyle = obj.color + '28'; // above horizon but blocked
      } else {
        continue; // below horizon — leave base bar colour
      }
      ctx.fillRect(x1, y, w, barH);
    }
  });

  // "Now" marker — only on tonight's view
  const nowMs = Date.now();
  if (isCurrent && nowMs >= t0 && nowMs <= t1) {
    const x = toX(nowMs);
    ctx.strokeStyle = '#ff6b6b';
    ctx.lineWidth   = 1.5;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(x, PT);
    ctx.lineTo(x, H - PB);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = '#ff6b6b';
    ctx.font      = '10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('now', x, PT - 8);
  }

  // Sky-view time marker
  if (skyMs !== undefined && skyMs >= t0 && skyMs <= t1) {
    const x = toX(skyMs);
    ctx.strokeStyle = '#58a6ff';
    ctx.lineWidth   = 2;
    ctx.beginPath();
    ctx.moveTo(x, PT - 4);
    ctx.lineTo(x, H - PB);
    ctx.stroke();
    ctx.fillStyle = '#58a6ff';
    ctx.font      = '10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(fmtTime(new Date(skyMs)), Math.min(Math.max(x, 22), W - 22), PT - 10);
  }
}

/** Tapping/clicking the timeline picks the sky-view time. */
export function setupTimelinePick(onPick: (ms: number) => void): void {
  const canvas = document.getElementById('timeline') as HTMLCanvasElement;
  canvas.addEventListener('click', e => {
    if (!tlGeom) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const f = (x - tlGeom.PL) / (rect.width - tlGeom.PL - tlGeom.PR);
    onPick(tlGeom.t0 + Math.min(Math.max(f, 0), 1) * (tlGeom.t1 - tlGeom.t0));
  });
}

// ─── Render: panorama ────────────────────────────────────────────────────────

export function renderPanorama(data: ObjectData[], isCurrent = false): void {
  const canvas = document.getElementById('panorama') as HTMLCanvasElement;
  const ctx    = canvas.getContext('2d')!;
  const dpr    = window.devicePixelRatio || 1;
  const W      = canvas.clientWidth;
  const H      = canvas.clientHeight;
  if (W === 0 || H === 0) return;

  canvas.width  = W * dpr;
  canvas.height = H * dpr;
  ctx.scale(dpr, dpr);

  const PL = 36, PR = 12, PT = 12, PB = 28;
  const plotW = W - PL - PR;
  const plotH = H - PT - PB;

  const toX = (az: number)  => PL + (az / 360) * plotW;
  const toY = (alt: number) => H - PB - (Math.max(alt, 0) / 90) * plotH;

  // Background
  ctx.fillStyle = '#161b22';
  ctx.fillRect(0, 0, W, H);

  // Viewing window shading
  for (const w of config.windows) {
    const lo = w.azCenter - w.halfWidth;
    const hi = w.azCenter + w.halfWidth;
    ctx.fillStyle = '#ffffff08';
    if (lo < 0) {
      // Wraps around 0°/360°: two rectangles
      const x1 = toX(lo + 360);
      ctx.fillRect(x1, PT, (W - PR) - x1, plotH);
      ctx.fillRect(PL, PT, toX(hi) - PL, plotH);
    } else if (hi > 360) {
      ctx.fillRect(toX(lo), PT, (W - PR) - toX(lo), plotH);
      ctx.fillRect(PL, PT, toX(hi - 360) - PL, plotH);
    } else {
      ctx.fillRect(toX(lo), PT, toX(hi) - toX(lo), plotH);
    }
  }

  // Altitude gridlines + labels
  const fontSize = Math.min(10, Math.max(8, W / 90));
  ctx.font      = `${fontSize}px monospace`;
  ctx.textAlign = 'right';
  for (const alt of [0, 15, 30, 45, 60, 75, 90]) {
    const y = toY(alt);
    ctx.strokeStyle = '#21262d';
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.moveTo(PL, y);
    ctx.lineTo(W - PR, y);
    ctx.stroke();
    ctx.fillStyle = '#4a5568';
    ctx.fillText(`${alt}°`, PL - 4, y + fontSize / 2);
  }

  // minAlt threshold line
  const minAltY = toY(config.minAlt);
  ctx.strokeStyle = '#ff6b6b44';
  ctx.lineWidth   = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(PL, minAltY);
  ctx.lineTo(W - PR, minAltY);
  ctx.stroke();
  ctx.setLineDash([]);

  // Azimuth axis tick marks + labels
  const compassPoints = [
    { az: 0,   label: 'N'  }, { az: 45,  label: 'NE' },
    { az: 90,  label: 'E'  }, { az: 135, label: 'SE' },
    { az: 180, label: 'S'  }, { az: 225, label: 'SW' },
    { az: 270, label: 'W'  }, { az: 315, label: 'NW' },
    { az: 360, label: 'N'  },
  ];
  ctx.strokeStyle = '#21262d';
  ctx.lineWidth   = 1;
  ctx.fillStyle   = '#4a5568';
  ctx.font        = `${fontSize}px monospace`;
  ctx.textAlign   = 'center';
  for (const pt of compassPoints) {
    const x = toX(pt.az);
    ctx.beginPath();
    ctx.moveTo(x, H - PB);
    ctx.lineTo(x, H - PB + 3);
    ctx.stroke();
    ctx.fillText(pt.label, x, H - PB + 4 + fontSize);
  }

  // Object paths — one segment at a time for per-segment colour
  ctx.lineWidth = 2;
  for (const obj of data) {
    for (let i = 0; i < obj.samples.length - 1; i++) {
      const cur  = obj.samples[i];
      const next = obj.samples[i + 1];
      if (cur.altitude <= 0 || next.altitude <= 0) continue;
      // Skip segments that cross the 0°/360° boundary
      if (Math.abs(next.azimuth - cur.azimuth) > 180) continue;

      ctx.strokeStyle = cur.visible ? obj.color : (obj.color + '40');
      ctx.beginPath();
      ctx.moveTo(toX(cur.azimuth),  toY(cur.altitude));
      ctx.lineTo(toX(next.azimuth), toY(next.altitude));
      ctx.stroke();
    }
  }

  // Current-position dots (tonight only)
  if (isCurrent) {
    for (const obj of data) {
      if (obj.curAlt <= 0) continue;
      const x = toX(obj.curAz);
      const y = toY(obj.curAlt);

      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.fillStyle = '#161b22';
      ctx.fill();

      ctx.beginPath();
      ctx.arc(x, y, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = obj.color;
      ctx.fill();

      ctx.fillStyle  = obj.color;
      ctx.font       = `${Math.min(11, Math.max(9, W / 80))}px sans-serif`;
      ctx.textAlign  = 'center';
      ctx.fillText(obj.name, x, y - 9);
    }
  }
}

// ─── Night navigation ─────────────────────────────────────────────────────────

export function updateNightNav(night: Night | null): void {
  document.getElementById('night-label')!.textContent = nightLabel(state.offsetDays);
  document.getElementById('night-info')!.textContent  = night
    ? `${fmtTime(night.start.date)} \u2192 ${fmtTime(night.end.date)}`
    : 'unavailable';
  (document.getElementById('nav-prev') as HTMLButtonElement).disabled = state.offsetDays <= MIN_OFFSET;
  (document.getElementById('nav-next') as HTMLButtonElement).disabled = state.offsetDays >= MAX_OFFSET;
  const label = state.offsetDays === 0 ? "Tonight's" : `${nightLabel(state.offsetDays)}`;
  document.getElementById('timeline-title')!.textContent = `${label} Visibility Timeline`;
}

export function setupNightNav(refresh: () => void): void {
  document.getElementById('nav-prev')!.addEventListener('click', () => {
    if (state.offsetDays > MIN_OFFSET) { state.offsetDays--; refresh(); }
  });
  document.getElementById('nav-next')!.addEventListener('click', () => {
    if (state.offsetDays < MAX_OFFSET) { state.offsetDays++; refresh(); }
  });
}

// ─── Settings ─────────────────────────────────────────────────────────────────

export function syncUI(): void {
  (document.getElementById('n-half')  as HTMLInputElement).value = String(config.windows[0].halfWidth);
  (document.getElementById('s-half')  as HTMLInputElement).value = String(config.windows[1].halfWidth);
  (document.getElementById('min-alt') as HTMLInputElement).value = String(config.minAlt);
  (document.getElementById('lat')     as HTMLInputElement).value = String(config.lat);
  (document.getElementById('lon')     as HTMLInputElement).value = String(config.lon);
  updateWindowHint('n', config.windows[0].halfWidth);
  updateWindowHint('s', config.windows[1].halfWidth);
  document.getElementById('min-alt-val')!.textContent = `${config.minAlt}\u00b0`;
}

function updateWindowHint(side: 'n' | 's', half: number): void {
  const center   = side === 'n' ? 0 : 180;
  const lo       = ((center - half + 360) % 360).toFixed(0);
  const hi       = ((center + half)       % 360).toFixed(0);
  document.getElementById(`${side}-half-val`)!.textContent = `\u00b1${half}\u00b0`;
  document.getElementById(`${side}-hint`)!.textContent     = `${lo}\u00b0 \u2013 ${hi}\u00b0`;
}

export function setupSettings(refresh: () => void): void {
  syncUI();

  const on = (id: string, fn: (v: number) => void) => {
    document.getElementById(id)!.addEventListener('input', e => {
      fn(Number((e.target as HTMLInputElement).value));
      saveConfig();
      refresh();
    });
  };

  on('n-half',  v => { config.windows[0].halfWidth = v; updateWindowHint('n', v); });
  on('s-half',  v => { config.windows[1].halfWidth = v; updateWindowHint('s', v); });
  on('min-alt', v => { config.minAlt = v; document.getElementById('min-alt-val')!.textContent = `${v}\u00b0`; });

  // Lat/lon on change (not input) to avoid partial-number triggers
  ['lat', 'lon'].forEach(id =>
    document.getElementById(id)!.addEventListener('change', e => {
      const v = Number((e.target as HTMLInputElement).value);
      if (isNaN(v)) return;
      if (id === 'lat') config.lat = v;
      else              config.lon = v;
      document.getElementById('location-label')!.textContent = `${config.lat}\u00b0N, ${config.lon}\u00b0E`;
      saveConfig();
      refresh();
    })
  );

  document.getElementById('settings-toggle')!.addEventListener('click', () => {
    document.getElementById('settings-panel')!.classList.toggle('hidden');
  });
}
