// Horizon editor: full-screen overlay to draw or adjust a window's horizon profile (walls, points, segment kinds,
// bare-tree rooflines) on an az x alt panorama, with the brightest stars / planets / Moon drawn behind it at a chosen
// time so the outline can be lined up with what is seen from the window. All geometry rules live in horizon-edit.ts.
import * as Astronomy from 'astronomy-engine';
import type { HorizonProfile, ProfileKind } from './config';
import { observer, getNight, getHorizon, sunAltitude, eqjToEnu, enuToAzAlt, OBJECTS } from './astro';
import { catalog } from './catalog';
import { fmtDateTime } from './format';
import { OBSTRUCTION, skyColors, rgb, twilightName, twilightLimit, starColor } from './sky/palette';
import {
  KINDS, KIND_LABEL, autoAltMax, deletePoint, insertPoint, movePoint, norm, outline, relOf, relsOf,
  setBare, setKind, shiftWall, spanOf,
} from './horizon-edit';

export interface EditorResult { profile: HorizonProfile; /** the user changed something */ changed: boolean; }

// Layout of the plot inside the canvas (CSS px) and touch sizes.
const PL = 30, PR = 8, PT = 6, PB = 22;
const HIT = 20;         // pointer hit radius for points / handles (40 px target)
const TAB_W = 30, TAB_H = 28;
const MIN_VW = 10;      // closest zoom: degrees across the plot
const TAP_PX = 8;       // movement below this is a tap

const KIND_DOT: Record<ProfileKind, string> = { building: '#9aa7bc', tree: '#6fbf7f', conifer: '#4fae7a', estimated: '#c8d2e2' };
const ACCENT = '#58a6ff';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};
const btn = (text: string, label: string, cls: string, onClick: () => void): HTMLButtonElement => {
  const b = el('button', cls, text);
  b.type = 'button'; b.title = label; b.setAttribute('aria-label', label);
  b.addEventListener('click', onClick);
  return b;
};
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

interface Dot { az: number; alt: number; mag: number; r: number; color: string; name?: string; body?: boolean; }

/** Indices of the catalogue stars bright enough to be drawn (computed once). */
let brightStars: number[] | null = null;
const BRIGHT_MAG = 3.2, LABEL_MAG = 1.6;

/** Stars (to mag 3.2) and the Moon / planets at `ms`, as az / alt dots. */
function skyDots(ms: number): Dot[] {
  const date = new Date(ms), obs = observer();
  if (!brightStars) { brightStars = []; for (let i = 0; i < catalog.nStars; i++) if (catalog.mag[i] <= BRIGHT_MAG) brightStars.push(i); }
  const m = eqjToEnu(date, obs), v = catalog.starVec;
  const out: Dot[] = [];
  for (const i of brightStars) {
    const x = v[i * 3], y = v[i * 3 + 1], z = v[i * 3 + 2];
    const u = m[6] * x + m[7] * y + m[8] * z;
    if (u < -0.05) continue;
    const { az, alt } = enuToAzAlt(m[0] * x + m[1] * y + m[2] * z, m[3] * x + m[4] * y + m[5] * z, u);
    const mag = catalog.mag[i];
    out.push({ az, alt, mag, r: 1 + (BRIGHT_MAG - mag) * 0.55, color: starColor(catalog.bv[i]), name: mag <= LABEL_MAG ? catalog.names.get(i) : undefined });
  }
  const t = Astronomy.MakeTime(date);
  for (const o of OBJECTS) {
    const h = getHorizon(o.body, t, obs);
    if (h.altitude < -2) continue;
    out.push({ az: h.azimuth, alt: h.altitude, mag: -4, r: o.name === 'Moon' ? 7 : 4, color: o.color, name: o.name, body: true });
  }
  return out;
}

/** Open the editor on a copy of `initial`. `onSave` runs when the user saves; cancelling just closes (nothing is written). */
export function openHorizonEditor(opts: { title: string; initial: HorizonProfile; onSave: (r: EditorResult) => void; onClose?: () => void }): void {
  if (document.getElementById('hz-editor')) return;

  // ── State ──
  let prof = structuredClone(opts.initial);
  /** Snapshots with the unwrapped west-wall azimuth they were taken at (a wall drag can move it by more than 180). */
  interface Snap { p: HorizonProfile; u: number; }
  const undo: Snap[] = [], redo: Snap[] = [];
  let sel = -1;
  /** Unwrapped azimuth of the west wall: the panorama's x axis is unwrapped, so nothing jumps at north. */
  let azMinU = prof.azMin;
  let vw = 0, vx0 = 0;              // visible degrees across the plot, unwrapped azimuth at its left edge
  let altMax = autoAltMax(prof);

  const obs = observer();
  const nowMs = Date.now();
  const night = getNight(new Date(nowMs), obs);
  const nightA = night?.start.date.getTime() ?? nowMs, nightB = night?.end.date.getTime() ?? nowMs;
  /** Now when it is night, otherwise the middle of tonight. */
  let ms = night && !(nowMs >= nightA && nowMs <= nightB) ? Math.round((nightA + nightB) / 2) : nowMs;
  let dots: Dot[] = [];
  let sunAlt = 0;

  // ── DOM ──
  const root = el('div', 'hz'); root.id = 'hz-editor';
  root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-label', 'Horizon editor');
  root.tabIndex = -1;

  const bar = el('div', 'hz-bar');
  const bCancel = btn('Cancel', 'Cancel and discard changes', 'hz-btn', () => cancel());
  bCancel.id = 'hz-cancel';
  const title = el('div', 'hz-title', opts.title);
  const bUndo = btn('Undo', 'Undo', 'hz-btn', () => doUndo()); bUndo.id = 'hz-undo';
  const bRedo = btn('Redo', 'Redo', 'hz-btn', () => doRedo()); bRedo.id = 'hz-redo';
  const bSave = btn('Save', 'Save horizon', 'hz-btn hz-btn--primary', () => save()); bSave.id = 'hz-save';
  bar.append(bCancel, title, bUndo, bRedo, bSave);

  const stage = el('div', 'hz-stage');
  const canvas = el('canvas', 'hz-canvas'); canvas.id = 'hz-canvas';
  const zoom = el('div', 'hz-zoom');
  zoom.append(
    btn('+', 'Zoom in', 'hz-tool', () => zoomBy(1 / 1.5)),
    btn('−', 'Zoom out', 'hz-tool', () => zoomBy(1.5)),
    btn('Fit', 'Fit to the window range', 'hz-tool hz-tool--text', () => { fitView(); invalidate(); }),
  );
  stage.append(canvas);

  const panel = el('div', 'hz-panel');
  const info = el('div', 'hz-info'); info.id = 'hz-info';
  const kinds = el('div', 'hz-row hz-kinds');
  const kindBtns = new Map<ProfileKind, HTMLButtonElement>();
  kinds.append(el('span', 'hz-lbl', 'Then'));
  for (const k of KINDS) {
    const b = btn(KIND_LABEL[k], `Segment after the point: ${KIND_LABEL[k]}`, 'hz-chip', () => edit(p => setKind(p, sel, k)));
    b.dataset.kind = k;
    b.style.setProperty('--dot', KIND_DOT[k]);
    kindBtns.set(k, b); kinds.append(b);
  }
  const moves = el('div', 'hz-row');
  const nudge = (dAz: number, dAlt: number) => () => {
    const pt = prof.points[sel]; if (!pt) return;
    edit(p => movePoint(p, sel, relOf(p, pt.az) + dAz, pt.alt + dAlt));
  };
  const bDel = btn('Delete', 'Delete point', 'hz-chip hz-chip--danger', () => {
    if (sel < 0 || prof.points.length <= 1) return;
    edit(p => deletePoint(p, sel), -1);
  });
  bDel.id = 'hz-delete';
  moves.append(
    btn('◀', 'Point 1 degree anticlockwise', 'hz-chip hz-nudge', nudge(-1, 0)),
    btn('▶', 'Point 1 degree clockwise', 'hz-chip hz-nudge', nudge(1, 0)),
    btn('▲', 'Point 1 degree higher', 'hz-chip hz-nudge', nudge(0, 1)),
    btn('▼', 'Point 1 degree lower', 'hz-chip hz-nudge', nudge(0, -1)),
    bDel,
  );
  const bareRow = el('div', 'hz-row hz-bare');
  const bareLbl = el('span', 'hz-lbl', 'Bare roofline');
  const bare = el('input', 'hz-range'); bare.type = 'range'; bare.min = '0'; bare.max = '60'; bare.step = '1'; bare.id = 'hz-bare';
  bare.setAttribute('aria-label', 'Roofline height behind the tree when bare');
  const bareVal = el('span', 'hz-val');
  bareRow.append(bareLbl, bare, bareVal);
  const top = el('div', 'hz-row hz-top');
  top.append(info, zoom);
  panel.append(top, kinds, moves, bareRow);

  const timeRow = el('div', 'hz-time');
  const timeTop = el('div', 'hz-row hz-timetop');
  const timeText = el('div', 'hz-timetext'); timeText.id = 'hz-time';
  const bNow = btn('Now', 'Show the sky now', 'hz-btn', () => { setTime(nowMs); });
  bNow.id = 'hz-now';
  timeTop.append(timeText, bNow);
  const slider = el('input', 'hz-range hz-scrub'); slider.type = 'range'; slider.id = 'hz-scrub';
  slider.min = '0'; slider.max = String(Math.max(1, Math.round((nightB - nightA) / 60000))); slider.step = '1';
  slider.setAttribute('aria-label', 'Time of night');
  slider.addEventListener('input', () => setTime(nightA + Number(slider.value) * 60000));
  timeRow.append(timeTop, slider);
  if (!night) slider.disabled = true;

  root.append(bar, stage, panel, timeRow);

  // ── Geometry ──
  let W = 0, H = 0, dpr = 1;
  const plotW = () => Math.max(1, W - PL - PR), plotH = () => Math.max(1, H - PT - PB);
  const xOf = (u: number) => PL + (u - vx0) / vw * plotW();
  const yOf = (alt: number) => PT + (1 - alt / altMax) * plotH();
  const uOfX = (x: number) => vx0 + (x - PL) / plotW() * vw;
  const altOfY = (y: number) => (1 - (y - PT) / plotH()) * altMax;
  /** Unwrapped azimuth of point i. */
  const ptU = (p: HorizonProfile, i: number) => azMinU + relsOf(p)[i];

  function fitView(): void {
    const span = spanOf(prof), margin = Math.max(6, span * 0.08);
    vw = clamp(span + 2 * margin, MIN_VW, 360);
    vx0 = azMinU + span / 2 - vw / 2;
  }
  function clampView(): void {
    vw = clamp(vw, MIN_VW, 360);
    const span = spanOf(prof), c = vx0 + vw / 2;
    vx0 += clamp(c, azMinU - 40, azMinU + span + 40) - c;
  }
  function zoomBy(f: number, atX = PL + plotW() / 2): void {
    const u = uOfX(atX);
    vw = clamp(vw * f, MIN_VW, 360);
    vx0 = u - (atX - PL) / plotW() * vw;
    clampView(); invalidate();
  }

  // ── Editing ──
  const same = (a: HorizonProfile, b: HorizonProfile) => a === b;
  function pushUndo(before: HorizonProfile, u = azMinU): void { undo.push({ p: before, u }); redo.length = 0; if (undo.length > 200) undo.shift(); }
  /** One undoable edit. `newSel`: selection afterwards (default: unchanged). */
  function edit(fn: (p: HorizonProfile) => HorizonProfile, newSel = sel): void {
    const next = fn(prof);
    if (same(next, prof)) return;
    pushUndo(prof); prof = next; sel = newSel; afterEdit();
  }
  function afterEdit(): void {
    altMax = Math.max(altMax, autoAltMax(prof));
    syncUI(); invalidate();
  }
  function doUndo(): void {
    const s = undo.pop(); if (!s) return;
    redo.push({ p: prof, u: azMinU }); restore(s);
  }
  function doRedo(): void {
    const s = redo.pop(); if (!s) return;
    undo.push({ p: prof, u: azMinU }); restore(s);
  }
  function restore(s: Snap): void {
    prof = s.p; azMinU = s.u;
    if (sel >= prof.points.length) sel = -1;
    afterEdit();
  }

  function cancel(): void {
    if (undo.length && !confirm('Discard your changes to this horizon?')) return;
    close();
  }
  function save(): void {
    opts.onSave({ profile: prof, changed: undo.length > 0 });
    close();
  }
  function close(): void {
    ro.disconnect();
    document.removeEventListener('keydown', onKey);
    document.body.classList.remove('hz-open');
    root.remove();
    opts.onClose?.();
  }
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); cancel(); } };

  // ── Time ──
  function setTime(t: number): void {
    ms = night ? clamp(t, nightA, nightB) : t;
    dots = skyDots(ms); sunAlt = sunAltitude(new Date(ms), obs);
    syncTime(); invalidate();
  }
  function syncTime(): void {
    if (night) slider.value = String(Math.round((ms - nightA) / 60000));
    timeText.textContent = `${fmtDateTime(new Date(ms))} · ${twilightName(sunAlt)}`;
  }

  // ── UI sync ──
  function syncUI(): void {
    bUndo.disabled = !undo.length; bRedo.disabled = !redo.length;
    const pt = prof.points[sel];
    for (const [k, b] of kindBtns) { b.disabled = !pt; b.classList.toggle('active', pt?.kind === k); }
    for (const b of moves.querySelectorAll('button')) (b as HTMLButtonElement).disabled = !pt;
    bDel.disabled = !pt || prof.points.length <= 1;
    const isTree = pt?.kind === 'tree';
    bareRow.classList.toggle('hidden', !isTree);
    if (isTree) {
      bare.max = String(Math.max(1, pt.alt));
      bare.value = String(pt.bare ?? pt.alt);
      bareVal.textContent = `${pt.bare ?? pt.alt}°`;
    }
    info.textContent = pt
      ? `Point ${sel + 1} of ${prof.points.length} · az ${pt.az}° · alt ${pt.alt}° · segment after it: ${KIND_LABEL[pt.kind].toLowerCase()}`
      : `Walls ${prof.azMin}° → ${prof.azMax}° · ${prof.points.length} points. Tap to add a point; drag a point or a wall tab.`;
  }
  let sliding = false;
  bare.addEventListener('input', () => {
    if (sel < 0) return;
    const v = Number(bare.value);
    if (!sliding) { sliding = true; pushUndo(prof); }
    prof = setBare(prof, sel, v); afterEdit();
  });
  bare.addEventListener('change', () => { sliding = false; });

  // ── Drawing ──
  const ctx = canvas.getContext('2d')!;
  let raf = 0;
  function invalidate(): void { if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); }); }

  /** Grid step in degrees that keeps labels about 40 px apart. */
  function gridStep(): number {
    const ppd = plotW() / vw;
    return [1, 2, 5, 10, 15, 30, 45, 90].find(s => s * ppd >= 40) ?? 90;
  }
  const COMPASS: Record<number, string> = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };

  function draw(): void {
    if (!W || !H) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const pw = plotW(), ph = plotH();
    ctx.fillStyle = '#0d1117'; ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.beginPath(); ctx.rect(PL, PT, pw, ph); ctx.clip();

    // sky at the chosen time
    const sc = skyColors(sunAlt);
    const g = ctx.createLinearGradient(0, PT, 0, PT + ph);
    g.addColorStop(0, rgb(sc.top)); g.addColorStop(1, rgb(sc.bottom));
    ctx.fillStyle = g; ctx.fillRect(PL, PT, pw, ph);

    // grid
    ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(139,148,158,0.16)';
    const step = gridStep();
    ctx.beginPath();
    for (let u = Math.ceil(vx0 / step) * step; u <= vx0 + vw; u += step) { const x = Math.round(xOf(u)) + 0.5; ctx.moveTo(x, PT); ctx.lineTo(x, PT + ph); }
    const altStep = ph / altMax * 10 >= 22 ? 10 : 20;
    for (let a = 0; a <= altMax; a += altStep) { const y = Math.round(yOf(a)) + 0.5; ctx.moveTo(PL, y); ctx.lineTo(PL + pw, y); }
    ctx.stroke();

    drawDots();
    drawObstruction();
    drawWalls();
    drawHandles();
    ctx.restore();
    drawAxes(step);
  }

  function drawDots(): void {
    const limit = twilightLimit(sunAlt);
    const cu = vx0 + vw / 2;
    ctx.font = '10px -apple-system, Segoe UI, Roboto, sans-serif'; ctx.textBaseline = 'middle';
    for (const d of dots) {
      if (d.alt > altMax + 2 || d.alt < -1) continue;
      const u = d.az + 360 * Math.round((cu - d.az) / 360);
      const x = xOf(u), y = yOf(d.alt);
      if (x < PL - 40 || x > PL + plotW() + 40) continue;
      // fainter than the sky allows at this time: drawn dim (a star you would not see yet)
      ctx.globalAlpha = d.body || d.mag <= limit ? 1 : 0.3;
      ctx.fillStyle = d.color;
      ctx.beginPath(); ctx.arc(x, y, d.r, 0, 6.2832); ctx.fill();
      if (d.body) { ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 1; ctx.stroke(); }
      if (d.name) { ctx.fillStyle = d.body ? '#f0e6c0' : 'rgba(220,228,240,0.85)'; ctx.fillText(d.name, x + d.r + 3, y - 1); }
    }
    ctx.globalAlpha = 1;
  }

  /** Runs of consecutive segments with the same kind, as [first vertex, last vertex] pairs. */
  function drawObstruction(): void {
    const o = outline(prof);
    if (o.length < 2) return;
    const base = yOf(0);
    let a = 0;
    ctx.lineJoin = 'round';
    while (a < o.length - 1) {
      let b = a + 1;
      while (b < o.length - 1 && o[b].kind === o[a].kind) b++;
      const kind = o[a].kind;
      const trace = (alt: (v: typeof o[number]) => number) => {
        ctx.beginPath(); ctx.moveTo(xOf(azMinU + o[a].rel), base);
        for (let k = a; k <= b; k++) ctx.lineTo(xOf(azMinU + o[k].rel), yOf(alt(o[k])));
        ctx.lineTo(xOf(azMinU + o[b].rel), base); ctx.closePath();
      };
      const line = (alt: (v: typeof o[number]) => number, style: string, w: number, dash: number[] = []) => {
        ctx.beginPath();
        for (let k = a; k <= b; k++) { const x = xOf(azMinU + o[k].rel), y = yOf(alt(o[k])); if (k === a) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
        ctx.strokeStyle = style; ctx.lineWidth = w; ctx.setLineDash(dash); ctx.stroke(); ctx.setLineDash([]);
      };
      if (kind === 'tree') {
        // crown in leaf, with the roofline behind it (what remains when the tree is bare) drawn dashed over it
        trace(v => v.alt); ctx.fillStyle = OBSTRUCTION.leaf.fill; ctx.fill();
        trace(v => v.bare); ctx.fillStyle = OBSTRUCTION.building.fill; ctx.fill();
        line(v => v.alt, OBSTRUCTION.leaf.edge, 2);
        line(v => v.bare, OBSTRUCTION.building.edge, 1.5, [4, 3]);
      } else {
        const st = OBSTRUCTION[kind];
        trace(v => v.alt); ctx.fillStyle = st.fill; ctx.fill();
        line(v => v.alt, st.edge, kind === 'conifer' ? 2 : 1.5, kind === 'estimated' ? [6, 5] : []);
      }
      a = b;
    }
    // the segment after the selected point
    const pt = prof.points[sel];
    if (pt) {
      const i = o.findIndex(v => v.point === sel);
      if (i >= 0 && i < o.length - 1) {
        ctx.beginPath();
        ctx.moveTo(xOf(azMinU + o[i].rel), yOf(o[i].alt)); ctx.lineTo(xOf(azMinU + o[i + 1].rel), yOf(o[i + 1].alt));
        ctx.strokeStyle = ACCENT; ctx.lineWidth = 3; ctx.stroke();
      }
    }
  }

  function wallX(which: 'min' | 'max'): number { return xOf(azMinU + (which === 'min' ? 0 : spanOf(prof))); }

  function drawWalls(): void {
    const xl = wallX('min'), xr = wallX('max'), top = PT, bot = PT + plotH();
    ctx.fillStyle = OBSTRUCTION.wall.fill;
    ctx.fillRect(PL - 1, top, xl - PL + 1, bot - top);
    ctx.fillRect(xr, top, PL + plotW() + 1 - xr, bot - top);
    ctx.strokeStyle = OBSTRUCTION.wall.edge; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(xl, top); ctx.lineTo(xl, bot); ctx.moveTo(xr, top); ctx.lineTo(xr, bot); ctx.stroke();
  }

  function drawHandles(): void {
    const rels = relsOf(prof), pw = plotW();
    let inView = 0;
    for (const r of rels) { const x = xOf(azMinU + r); if (x >= PL && x <= PL + pw) inView++; }
    const small = inView > pw / 12;        // dense profile: keep the dots from smearing into a band
    prof.points.forEach((pt, i) => {
      const x = xOf(azMinU + rels[i]), y = yOf(pt.alt);
      if (x < PL - 10 || x > PL + pw + 10) return;
      const on = i === sel;
      ctx.beginPath(); ctx.arc(x, y, on ? 8 : small ? 2.5 : 5.5, 0, 6.2832);
      ctx.fillStyle = on ? ACCENT : KIND_DOT[pt.kind]; ctx.fill();
      ctx.lineWidth = on ? 2 : 1; ctx.strokeStyle = on ? '#fff' : 'rgba(13,17,23,0.8)'; ctx.stroke();
    });
    const pt = prof.points[sel];
    if (pt?.kind === 'tree') {                    // second handle: roofline behind the tree
      const x = xOf(azMinU + rels[sel]), y = yOf(pt.bare ?? pt.alt);
      ctx.strokeStyle = 'rgba(230,237,243,0.5)'; ctx.setLineDash([2, 3]); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, yOf(pt.alt)); ctx.lineTo(x, y); ctx.stroke(); ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(x, y - 8); ctx.lineTo(x + 8, y); ctx.lineTo(x, y + 8); ctx.lineTo(x - 8, y); ctx.closePath();
      ctx.fillStyle = '#d29922'; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
    }
    // wall tabs with their azimuth
    ctx.font = '600 10px -apple-system, Segoe UI, Roboto, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const which of ['min', 'max'] as const) {
      const x = wallX(which), y = PT + 4 + TAB_H / 2;
      ctx.fillStyle = dragKind === 'wall' && dragWall === which ? ACCENT : '#30363d';
      ctx.strokeStyle = '#8b949e'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.roundRect(x - TAB_W / 2, y - TAB_H / 2, TAB_W, TAB_H, 6); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#e6edf3'; ctx.beginPath();
      for (const dx of [-4, 0, 4]) { ctx.moveTo(x + dx, y - 6); ctx.lineTo(x + dx, y + 6); }
      ctx.stroke();
      ctx.fillStyle = '#e6edf3';
      ctx.fillText(`${which === 'min' ? prof.azMin : prof.azMax}°`, x, y + TAB_H / 2 + 8);
    }
    ctx.textAlign = 'start';
  }

  function drawAxes(step: number): void {
    const pw = plotW(), ph = plotH();
    ctx.font = '10px -apple-system, Segoe UI, Roboto, sans-serif'; ctx.textBaseline = 'top'; ctx.textAlign = 'center';
    for (let u = Math.ceil(vx0 / step) * step; u <= vx0 + vw; u += step) {
      const x = xOf(u), az = norm(u), name = COMPASS[az];
      if (x < PL + 8 || x > PL + pw - 8) continue;
      ctx.fillStyle = name ? ACCENT : '#8b949e';
      ctx.font = `${name ? '600 ' : ''}10px -apple-system, Segoe UI, Roboto, sans-serif`;
      ctx.fillText(name && step >= 5 ? name : `${az}°`, x, PT + ph + 5);
    }
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#8b949e'; ctx.font = '10px -apple-system, Segoe UI, Roboto, sans-serif';
    const altStep = ph / altMax * 10 >= 22 ? 10 : 20;
    for (let a = 0; a <= altMax; a += altStep) ctx.fillText(`${a}°`, PL - 4, clamp(yOf(a), PT + 6, PT + ph - 2));
    ctx.textAlign = 'start';
    void pw;
  }

  // ── Pointer handling ──
  type Hit = { kind: 'bare' } | { kind: 'point'; i: number } | { kind: 'wall'; which: 'min' | 'max' } | null;
  let dragKind: 'none' | 'point' | 'bare' | 'wall' | 'pan' = 'none';
  let dragWall: 'min' | 'max' = 'min';
  let drag: { base: HorizonProfile; i: number; offU: number; offAlt: number; u0: number; azMinU0: number; x0: number; y0: number; vx00: number; moved: boolean; pushed: boolean } | null = null;
  const pointers = new Map<number, { x: number; y: number }>();
  let pinch: { d0: number; vw0: number } | null = null;

  const local = (e: PointerEvent) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

  function hitTest(x: number, y: number): Hit {
    const pt = prof.points[sel];
    if (pt?.kind === 'tree') {
      const bx = xOf(azMinU + relsOf(prof)[sel]), by = yOf(pt.bare ?? pt.alt);
      if (Math.hypot(x - bx, y - by) <= HIT) return { kind: 'bare' };
    }
    for (const which of ['min', 'max'] as const) {           // tabs sit above the plot content: they win in their own box
      const wx = wallX(which);
      if (Math.abs(x - wx) <= TAB_W / 2 + 6 && y >= PT && y <= PT + 4 + TAB_H + 10) return { kind: 'wall', which };
    }
    const rels = relsOf(prof);
    let best = -1, bd = HIT;
    for (let i = 0; i < rels.length; i++) {
      const px = xOf(azMinU + rels[i]);
      if (Math.abs(px - x) > HIT) continue;
      const d = Math.hypot(px - x, yOf(prof.points[i].alt) - y);
      if (d < bd || (d === bd && i === sel)) { bd = d; best = i; }
    }
    if (best >= 0) return { kind: 'point', i: best };
    for (const which of ['min', 'max'] as const) if (Math.abs(x - wallX(which)) <= 12) return { kind: 'wall', which };
    return null;
  }

  canvas.addEventListener('pointerdown', e => {
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    const p = local(e);
    pointers.set(e.pointerId, p);
    if (pointers.size === 2) {                           // pinch: abandon whatever one finger was doing
      const [a, b] = [...pointers.values()];
      pinch = { d0: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), vw0: vw };
      dragKind = 'none'; drag = null;
      return;
    }
    if (pointers.size > 2) return;
    const hit = hitTest(p.x, p.y);
    const base = { base: prof, i: -1, offU: 0, offAlt: 0, u0: uOfX(p.x), azMinU0: azMinU, x0: p.x, y0: p.y, vx00: vx0, moved: false, pushed: false };
    if (hit?.kind === 'point') {
      sel = hit.i; syncUI();
      const pt = prof.points[hit.i];
      drag = { ...base, i: hit.i, offU: uOfX(p.x) - ptU(prof, hit.i), offAlt: altOfY(p.y) - pt.alt };
      dragKind = 'point';
    } else if (hit?.kind === 'bare') {
      const pt = prof.points[sel];
      drag = { ...base, i: sel, offAlt: altOfY(p.y) - (pt.bare ?? pt.alt) };
      dragKind = 'bare';
    } else if (hit?.kind === 'wall') {
      drag = base; dragKind = 'wall'; dragWall = hit.which;
    } else {
      drag = base; dragKind = 'pan';
    }
    invalidate();
  });

  canvas.addEventListener('pointermove', e => {
    if (!pointers.has(e.pointerId)) return;
    e.preventDefault();
    const p = local(e);
    const mid = (m: Map<number, { x: number; y: number }>) => { const [a, b] = [...m.values()]; return (a.x + b.x) / 2; };
    const mxPrev = pinch && pointers.size === 2 ? mid(pointers) : 0;
    pointers.set(e.pointerId, p);
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), mx = mid(pointers);
      const uMid = uOfX(mxPrev);                         // the degree under the fingers stays under them
      vw = clamp(pinch.vw0 * pinch.d0 / d, MIN_VW, 360);
      vx0 = uMid - (mx - PL) / plotW() * vw;
      clampView(); invalidate();
      return;
    }
    if (!drag) return;
    if (!drag.moved && Math.hypot(p.x - drag.x0, p.y - drag.y0) < TAP_PX) return;
    drag.moved = true;
    const d = drag;
    if (dragKind === 'pan') {
      vx0 = d.vx00 - (p.x - d.x0) / plotW() * vw; clampView(); invalidate();
    } else if (dragKind === 'point') {
      // the altitude axis only grows when the drag ends, so it never rescales under the finger
      const next = movePoint(d.base, d.i, uOfX(p.x) - d.offU - azMinU, Math.min(altMax, altOfY(p.y) - d.offAlt));
      if (next !== prof) { if (!d.pushed) { pushUndo(d.base, d.azMinU0); d.pushed = true; } prof = next; syncUI(); invalidate(); }
    } else if (dragKind === 'bare') {
      const next = setBare(d.base, d.i, Math.min(altMax, altOfY(p.y) - d.offAlt));
      if (next !== prof) { if (!d.pushed) { pushUndo(d.base, d.azMinU0); d.pushed = true; } prof = next; syncUI(); invalidate(); }
    } else if (dragKind === 'wall') {
      const next = shiftWall(d.base, dragWall, uOfX(p.x) - d.u0);
      if (next !== prof) {
        if (!d.pushed) { pushUndo(d.base, d.azMinU0); d.pushed = true; }
        prof = next;
        azMinU = d.azMinU0 + (dragWall === 'min' ? spanOf(d.base) - spanOf(next) : 0);
        sel = -1; syncUI(); invalidate();
      }
    }
  });

  const end = (e: PointerEvent) => {
    if (!pointers.has(e.pointerId)) return;
    const p = local(e);
    pointers.delete(e.pointerId);
    if (pinch) { if (pointers.size < 2) pinch = null; if (!pointers.size) { dragKind = 'none'; drag = null; } return; }
    const d = drag; const kind = dragKind;
    drag = null; dragKind = 'none';
    if (e.type === 'pointercancel' || !d) { invalidate(); return; }
    if (kind === 'pan' && !d.moved) tap(p.x, p.y);
    altMax = Math.max(altMax, autoAltMax(prof));
    if (kind === 'wall') {                       // a wall dragged out of view: show the whole window again
      const x0 = wallX('min'), x1 = wallX('max');
      if (x0 < PL + TAB_W / 2 || x1 > PL + plotW() - TAB_W / 2) fitView(); else clampView();
    }
    syncUI(); invalidate();
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('wheel', e => { e.preventDefault(); zoomBy(e.deltaY > 0 ? 1.15 : 1 / 1.15, local(e as unknown as PointerEvent).x); }, { passive: false });
  canvas.addEventListener('contextmenu', e => e.preventDefault());

  /** Tap on empty plot: add a point there (inside the walls); outside them just deselect. */
  function tap(x: number, y: number): void {
    const rel = uOfX(x) - azMinU, alt = altOfY(y);
    if (x < PL || y < PT || y > PT + plotH() || rel < -0.5 || rel > spanOf(prof) + 0.5 || alt < -1) { sel = -1; return; }
    const r = insertPoint(prof, rel, Math.max(0, alt));
    pushUndo(prof); prof = r.profile; sel = r.index; afterEdit();
  }

  // ── Sizing ──
  const ro = new ResizeObserver(() => {
    dpr = window.devicePixelRatio || 1;
    const w = stage.clientWidth, h = stage.clientHeight;
    if (!w || !h) return;
    const first = !W;
    W = w; H = h;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    if (first) fitView();
    invalidate();
  });

  // ── Go ──
  document.body.classList.add('hz-open');
  document.body.append(root);
  document.addEventListener('keydown', onKey);
  ro.observe(stage);
  setTime(ms);
  syncUI();
  root.focus({ preventScroll: true });

  // Test/debug hook (like window.__astromap): drive the editor state without pixel arithmetic.
  (window as unknown as { __hz?: unknown }).__hz = {
    get profile() { return prof; },
    get view() { return { vx0, vw, altMax, azMinU, W, H }; },
    px: (az: number, alt: number) => { const r = canvas.getBoundingClientRect(); return { x: r.left + xOf(azMinU + norm(az - prof.azMin)), y: r.top + yOf(alt) }; },
    wallPx: (which: 'min' | 'max') => { const r = canvas.getBoundingClientRect(); return { x: r.left + wallX(which), y: r.top + PT + 4 + TAB_H / 2 }; },
  };
}
