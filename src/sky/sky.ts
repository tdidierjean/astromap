// Sky view: canvas renderer, pan/zoom interaction, tap-for-info.
import * as Astronomy from 'astronomy-engine';
import { config, type ViewWindow } from '../config';
import { visibility, isVisible, leafOn, sampleProfile, type ProfileSample } from '../horizon';
import { catalog } from '../catalog';
import {
  OBJECTS, observer, getHorizon, bodyMagnitude, eqjToEnu, enuToAzAlt, azAltToEnu,
  findVisSpans, sampleFixedStar, type Night, type ObjectData, type Sample,
} from '../astro';
import { fmtTime, moonPhaseText } from '../format';
import { Camera, clamp, altForHorizon, FOV_MIN, FOV_MAX, ALT_MIN, ALT_MAX, type View } from './camera';
import { skyColors, rgb, twilightName, twilightLimit, starColor } from './palette';

const D2R = Math.PI / 180;
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
export const compassName = (az: number) => COMPASS[Math.round(az / 45) % 8];

interface BodyState {
  name: string; color: string;
  az: number; alt: number; enu: [number, number, number]; mag: number;
}

type Selection = { kind: 'star'; i: number } | { kind: 'body'; i: number } | null;
interface Hit { sel: NonNullable<Selection>; x: number; y: number; bias: number; }

export class SkyView {
  private ctx: CanvasRenderingContext2D;
  private cam = new Camera();
  private view: View = { az: 180, alt: 60, fov: 100 };
  private winIdx = 0;
  private dpr = 1;

  // time-dependent state
  private timeMs = Date.now();
  private m: Float64Array = new Float64Array(9);
  private sunAlt = -30;
  private sunEnu: [number, number, number] = [0, 0, -1];
  private moonElong = 180;
  private bodies: BodyState[] = [];

  private night: Night | null = null;
  private data: ObjectData[] = [];
  private spanCache = new Map<string, Sample[]>();

  // per-frame scratch
  private sx = new Float32Array(catalog.nStars);
  private sy = new Float32Array(catalog.nStars);
  private su = new Float32Array(catalog.nStars); // sine of altitude
  private drawn = new Uint8Array(catalog.nStars);
  private nLineV = catalog.lineMag.length;
  private lx = new Float32Array(this.nLineV);
  private ly = new Float32Array(this.nLineV);
  private lok = new Uint8Array(this.nLineV);
  private starRgb: string[] = Array.from(catalog.bv, b => starColor(b));
  private tmp = new Float64Array(2);
  private labelRects: Array<[number, number, number, number]> = [];
  private hits: Hit[] = [];

  private selected: Selection = null;
  private raf = 0;
  private needsCamReset = true;

  constructor(private canvas: HTMLCanvasElement, private stage: HTMLElement, private infoEl: HTMLElement) {
    this.ctx = canvas.getContext('2d')!;
    this.setTime(Date.now());
    this.attachInput();
    new ResizeObserver(() => this.resize()).observe(stage);
    infoEl.addEventListener('click', e => {
      if ((e.target as HTMLElement).closest('.sky-info__close')) this.select(null);
    });
    this.resize();
  }

  // ── public API ────────────────────────────────────────────────────────────

  get windowIndex(): number { return this.winIdx; }
  get time(): number { return this.timeMs; }
  get currentView(): View { return { ...this.view }; }

  setWindow(i: number): void {
    this.winIdx = clamp(i, 0, config.windows.length - 1);
    this.resetView();
  }

  setNight(night: Night | null, data: ObjectData[]): void {
    this.night = night; this.data = data; this.spanCache.clear();
    this.refreshInfo();
    this.requestRender();
  }

  /** Call after window/min-altitude/limiting-magnitude settings changed. */
  settingsChanged(): void {
    this.spanCache.clear();
    if (this.winIdx >= config.windows.length) this.winIdx = 0;
    this.refreshInfo();
    this.requestRender();
  }

  setView(v: Partial<View>): void {
    this.view = { ...this.view, ...v };
    this.view.fov = clamp(this.view.fov, FOV_MIN, FOV_MAX);
    this.view.alt = clamp(this.view.alt, ALT_MIN, ALT_MAX);
    this.view.az = ((this.view.az % 360) + 360) % 360;
    this.requestRender();
  }

  resetView(): void {
    const w = config.windows[this.winIdx];
    if (!w) return;
    const W = this.cam.W, H = this.cam.H;
    const fov = clamp(w.halfWidth * 2 * 1.08, 70, 150);
    this.view = { az: w.azCenter, alt: W > 1 ? altForHorizon(fov, W, H) : 55, fov };
    this.needsCamReset = false;
    this.requestRender();
  }

  setTime(ms: number): void {
    this.timeMs = ms;
    const date = new Date(ms);
    const obs = observer();
    const t = Astronomy.MakeTime(date);
    this.m = eqjToEnu(date, obs);

    const sun = getHorizon(Astronomy.Body.Sun, t, obs, null);
    this.sunAlt = sun.altitude;
    this.sunEnu = azAltToEnu(sun.azimuth, sun.altitude);

    this.bodies = OBJECTS.map(o => {
      const hz = getHorizon(o.body, t, obs, null);
      return { name: o.name, color: o.color, az: hz.azimuth, alt: hz.altitude,
               enu: azAltToEnu(hz.azimuth, hz.altitude), mag: bodyMagnitude(o.body, t) };
    });
    this.moonElong = Astronomy.MoonPhase(t);
    this.refreshInfo();
    this.requestRender();
  }

  get sunAltitude(): number { return this.sunAlt; }
  get skyStateLabel(): string { return twilightName(this.sunAlt); }

  /** Visible rendering/debugging helper: alt/az of a catalogue star at the current time. */
  starAltAz(i: number) {
    const v = catalog.starVec, m = this.m;
    const x = v[i * 3], y = v[i * 3 + 1], z = v[i * 3 + 2];
    return enuToAzAlt(m[0] * x + m[1] * y + m[2] * z, m[3] * x + m[4] * y + m[5] * z, m[6] * x + m[7] * y + m[8] * z);
  }

  requestRender(): void {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => { this.raf = 0; this.render(); });
  }

  // ── sizing ────────────────────────────────────────────────────────────────

  private resize(): void {
    const W = this.stage.clientWidth, H = this.stage.clientHeight;
    if (W === 0 || H === 0) return;
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(W * this.dpr);
    this.canvas.height = Math.round(H * this.dpr);
    const first = this.needsCamReset || this.cam.W <= 1;
    this.cam.W = W; this.cam.H = H;
    if (first) this.resetView();
    this.render();
  }

  // ── effective limiting magnitude ──────────────────────────────────────────

  private effLimit(): number {
    return Math.min(config.limitMag, twilightLimit(this.sunAlt));
  }

  /** Extra dimming of stars near the horizon (extinction + city skyglow). */
  private horizonPenalty(sinAlt: number): number {
    return sinAlt < 0.2 ? (0.2 - sinAlt) / 0.2 * 1.3 : 0;
  }

  // ── rendering ─────────────────────────────────────────────────────────────

  render(): void {
    const { ctx, cam } = this;
    const W = this.stage.clientWidth, H = this.stage.clientHeight;
    if (W === 0 || H === 0) return;
    cam.set(this.view, W, H);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.labelRects.length = 0;
    this.hits.length = 0;

    const win = config.windows[this.winIdx];
    const lim = this.effLimit();
    const zf = clamp(Math.sqrt(100 / this.view.fov), 0.85, 1.7);

    // Background
    const sc = skyColors(this.sunAlt);
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, rgb(sc.top)); g.addColorStop(1, rgb(sc.bottom));
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    this.transformStars();
    if (config.showGrid) this.drawGrid();
    this.drawConstellationLines(lim);
    this.drawAsterismLines();
    this.drawStars(lim, zf);
    this.drawBodies(zf);
    if (win) this.drawWindowMask(win);
    this.drawGround();
    if (win?.profile) this.drawProfile(win);
    this.drawHorizon();
    this.drawLabels(lim, win);
    this.drawSelection();
  }

  /** Rotate all catalogue vectors into the camera frame and project them. */
  private transformStars(): void {
    const { cam, m } = this;
    const sv = catalog.starVec, lv = catalog.lineVec;
    const W = cam.W, H = cam.H, S2 = 2 * cam.S, hw = W / 2, hh = H / 2;
    const [rx, ry, rz] = cam.r, [ux, uy, uz] = cam.u, [fx, fy, fz] = cam.f;
    // Combined matrix: J2000 equatorial -> camera (right, up, forward)
    const c00 = rx * m[0] + ry * m[3] + rz * m[6], c01 = rx * m[1] + ry * m[4] + rz * m[7], c02 = rx * m[2] + ry * m[5] + rz * m[8];
    const c10 = ux * m[0] + uy * m[3] + uz * m[6], c11 = ux * m[1] + uy * m[4] + uz * m[7], c12 = ux * m[2] + uy * m[5] + uz * m[8];
    const c20 = fx * m[0] + fy * m[3] + fz * m[6], c21 = fx * m[1] + fy * m[4] + fz * m[7], c22 = fx * m[2] + fy * m[5] + fz * m[8];
    const m6 = m[6], m7 = m[7], m8 = m[8];

    for (let i = 0, n = catalog.nStars; i < n; i++) {
      const x = sv[i * 3], y = sv[i * 3 + 1], z = sv[i * 3 + 2];
      const pz = c20 * x + c21 * y + c22 * z;
      this.su[i] = m6 * x + m7 * y + m8 * z;
      if (pz < -0.92) { this.drawn[i] = 0; continue; }
      const k = S2 / (1 + pz);
      this.sx[i] = hw + k * (c00 * x + c01 * y + c02 * z);
      this.sy[i] = hh - k * (c10 * x + c11 * y + c12 * z);
      this.drawn[i] = 1;
    }
    for (let i = 0; i < this.nLineV; i++) {
      const x = lv[i * 3], y = lv[i * 3 + 1], z = lv[i * 3 + 2];
      const pz = c20 * x + c21 * y + c22 * z;
      if (pz < -0.92) { this.lok[i] = 0; continue; }
      const k = S2 / (1 + pz);
      this.lx[i] = hw + k * (c00 * x + c01 * y + c02 * z);
      this.ly[i] = hh - k * (c10 * x + c11 * y + c12 * z);
      this.lok[i] = 1;
    }
  }

  private onScreen(x: number, y: number, pad = 20): boolean {
    return x > -pad && x < this.cam.W + pad && y > -pad && y < this.cam.H + pad;
  }

  private drawGrid(): void {
    const { ctx } = this;
    ctx.strokeStyle = 'rgba(140,170,220,0.13)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let alt = 15; alt < 90; alt += 15) this.traceAzAlt(az => [az, alt], 0, 360, 4);
    for (let az = 0; az < 360; az += 30) this.traceAzAlt(a => [az, a], 0, 90, 5);
    ctx.stroke();
  }

  /** Add a polyline (parametrised by t) to the current path, breaking where points are not projectable. */
  private traceAzAlt(f: (t: number) => [number, number], t0: number, t1: number, step: number): void {
    const { ctx, cam, tmp } = this;
    let pen = false;
    for (let t = t0; t <= t1 + 1e-9; t += step) {
      const [az, alt] = f(t);
      const [e, n, u] = azAltToEnu(az, alt);
      if (!cam.project(e, n, u, tmp)) { pen = false; continue; }
      if (pen) ctx.lineTo(tmp[0], tmp[1]); else { ctx.moveTo(tmp[0], tmp[1]); pen = true; }
    }
  }

  private drawConstellationLines(lim: number): void {
    const { ctx } = this;
    const seg = catalog.lineSeg, lm = catalog.lineMag, W = this.cam.W, H = this.cam.H;
    const bright: number[] = [], faint: number[] = [];
    for (let s = 0; s < seg.length; s += 2) {
      const a = seg[s], b = seg[s + 1];
      if (!this.lok[a] || !this.lok[b]) continue;
      const ma = lm[a], mb = lm[b];
      if (ma > lim && mb > lim) continue; // both endpoints invisible: hide
      const ax = this.lx[a], ay = this.ly[a], bx = this.lx[b], by = this.ly[b];
      if ((ax < 0 && bx < 0) || (ax > W && bx > W) || (ay < 0 && by < 0) || (ay > H && by > H)) continue;
      (ma > lim || mb > lim ? faint : bright).push(ax, ay, bx, by);
    }
    const stroke = (arr: number[], style: string) => {
      if (!arr.length) return;
      ctx.strokeStyle = style; ctx.lineWidth = 1; ctx.beginPath();
      for (let i = 0; i < arr.length; i += 4) { ctx.moveTo(arr[i], arr[i + 1]); ctx.lineTo(arr[i + 2], arr[i + 3]); }
      ctx.stroke();
    };
    stroke(faint, 'rgba(120,150,200,0.10)');
    stroke(bright, 'rgba(120,160,215,0.28)');
  }

  private drawAsterismLines(): void {
    const { ctx } = this;
    ctx.strokeStyle = 'rgba(130,190,255,0.62)';
    ctx.lineWidth = 1.8;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (const a of catalog.asterisms) {
      for (const p of a.paths) {
        let pen = false;
        for (const i of p) {
          if (!this.drawn[i]) { pen = false; continue; }
          if (pen) ctx.lineTo(this.sx[i], this.sy[i]); else { ctx.moveTo(this.sx[i], this.sy[i]); pen = true; }
        }
      }
    }
    ctx.stroke();
  }

  private drawStars(lim: number, zf: number): void {
    const { ctx } = this;
    const mag = catalog.mag, n = catalog.nStars;
    for (let i = 0; i < n; i++) {
      if (!this.drawn[i]) continue;
      const u = this.su[i];
      if (u < 0) continue;                               // below the horizon
      const mEff = mag[i] + this.horizonPenalty(u);
      if (mEff > lim) continue;
      const x = this.sx[i], y = this.sy[i];
      if (!this.onScreen(x, y, 8)) continue;
      const r = Math.max(0.7, (0.75 + (5.6 - mag[i]) * 0.4) * zf);
      const alpha = clamp((lim - mEff) / 1.5 + 0.4, 0.4, 1);
      ctx.globalAlpha = alpha;
      if (mag[i] < 1.7) {
        const gr = ctx.createRadialGradient(x, y, 0, x, y, r * 4.5);
        gr.addColorStop(0, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(x, y, r * 4.5, 0, 6.2832); ctx.fill();
      }
      ctx.fillStyle = this.starRgb[i];
      ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill();
      ctx.globalAlpha = 1;
      this.hits.push({ sel: { kind: 'star', i }, x, y, bias: 0 });
    }
  }

  private drawBodies(zf: number): void {
    const { ctx, cam, tmp } = this;
    // Sun (only when near/above the horizon)
    if (this.sunAlt > -4 && cam.project(...this.sunEnu, tmp)) {
      const [x, y] = [tmp[0], tmp[1]];
      const gr = ctx.createRadialGradient(x, y, 0, x, y, 40);
      gr.addColorStop(0, 'rgba(255,230,160,0.55)'); gr.addColorStop(1, 'rgba(255,230,160,0)');
      ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(x, y, 40, 0, 6.2832); ctx.fill();
      ctx.fillStyle = '#ffe9a8'; ctx.beginPath(); ctx.arc(x, y, 7, 0, 6.2832); ctx.fill();
    }
    this.bodies.forEach((b, i) => {
      if (b.alt < -1) return;
      if (!cam.project(b.enu[0], b.enu[1], b.enu[2], tmp)) return;
      const x = tmp[0], y = tmp[1];
      if (!this.onScreen(x, y, 30)) return;
      this.hits.push({ sel: { kind: 'body', i }, x, y, bias: 14 }); // planets win ties over stars
      if (b.name === 'Moon') { this.drawMoon(x, y, clamp(9 * zf, 8, 15), b); return; }
      const r = clamp(3.1 - b.mag * 0.5, 2.6, 5.8) * Math.min(zf, 1.3);
      const gr = ctx.createRadialGradient(x, y, 0, x, y, r * 5);
      gr.addColorStop(0, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(x, y, r * 5, 0, 6.2832); ctx.fill();
      ctx.fillStyle = b.color; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill();
    });
  }

  private drawMoon(x: number, y: number, r: number, b: BodyState): void {
    const { ctx, cam, tmp } = this;
    // Direction on screen towards the Sun (bright limb side)
    const [mx, my, mz] = b.enu, [sx, sy, sz] = this.sunEnu;
    const d = mx * sx + my * sy + mz * sz;
    let tx = sx - d * mx, ty = sy - d * my, tz = sz - d * mz;
    const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
    const eps = 0.03, p2 = [0, 0];
    let theta = 0;
    const qx = mx + eps * tx, qy = my + eps * ty, qz = mz + eps * tz, ql = Math.hypot(qx, qy, qz);
    if (cam.project(qx / ql, qy / ql, qz / ql, tmp)) { p2[0] = tmp[0]; p2[1] = tmp[1]; theta = Math.atan2(p2[1] - y, p2[0] - x); }

    const gr = ctx.createRadialGradient(x, y, r * 0.8, x, y, r * 4);
    gr.addColorStop(0, 'rgba(230,230,200,0.22)'); gr.addColorStop(1, 'rgba(230,230,200,0)');
    ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(x, y, r * 4, 0, 6.2832); ctx.fill();

    ctx.save();
    ctx.translate(x, y); ctx.rotate(theta);
    // dark side (earthshine)
    ctx.fillStyle = '#262b36'; ctx.beginPath(); ctx.arc(0, 0, r, 0, 6.2832); ctx.fill();
    // lit part: +x semicircle, returned along the terminator ellipse
    const A = r * Math.cos(this.moonElong * D2R);
    ctx.fillStyle = '#efecd6';
    ctx.beginPath();
    ctx.arc(0, 0, r, -Math.PI / 2, Math.PI / 2, false);
    for (let t = Math.PI / 2; t >= -Math.PI / 2 - 1e-6; t -= Math.PI / 24) ctx.lineTo(A * Math.cos(t), r * Math.sin(t));
    ctx.closePath(); ctx.fill();
    ctx.restore();
    ctx.strokeStyle = 'rgba(200,200,180,0.5)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.stroke();
  }

  /** Dim everything outside the selected window's azimuth range / below minAlt (or outside a profile's walls). */
  private drawWindowMask(win: ViewWindow): void {
    const prof = win.profile;
    if (!prof && win.halfWidth >= 180 && config.minAlt <= 0) return;
    const { ctx, cam, tmp } = this;
    const floor = prof ? 0 : config.minAlt;
    const pts: Array<[number, number]> = [];
    const add = (az: number, alt: number) => {
      const [e, n, u] = azAltToEnu(az, alt);
      cam.projectClamped(e, n, u, tmp);
      pts.push([tmp[0], tmp[1]]);
    };
    const lo = prof ? prof.azMin : win.azCenter - win.halfWidth, hi = prof ? prof.azMax : win.azCenter + win.halfWidth;
    const full = !prof && win.halfWidth >= 180;
    const a0 = full ? 0 : lo, a1 = full ? 360 : hi;
    for (let az = a0; az < a1; az += 3) add(az, floor);
    add(a1, floor);
    if (!full) {
      for (let alt = floor + 5; alt < 90; alt += 5) add(hi, alt);
      add(hi, 90);
      for (let alt = 85; alt > floor; alt -= 5) add(lo, alt);
    }
    const trace = () => { pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath(); };

    ctx.beginPath();
    ctx.rect(0, 0, cam.W, cam.H);
    trace();
    ctx.fillStyle = 'rgba(5,8,14,0.62)';
    ctx.fill('evenodd');

    if (prof) return; // the profile drawing outlines the region itself

    // Outline of the visible region
    ctx.beginPath(); trace();
    ctx.strokeStyle = 'rgba(110,170,255,0.30)'; ctx.lineWidth = 1; ctx.setLineDash([5, 4]);
    ctx.stroke(); ctx.setLineDash([]);
  }

  /** Path of an az/alt polyline (projected). */
  private pathPts(list: Array<[number, number]>, move: boolean): void {
    const { ctx, cam, tmp } = this;
    list.forEach(([az, alt], i) => {
      const [e, n, u] = azAltToEnu(az, alt);
      cam.projectClamped(e, n, u, tmp);
      if (i === 0 && move) ctx.moveTo(tmp[0], tmp[1]); else ctx.lineTo(tmp[0], tmp[1]);
    });
  }

  /** Walls and obstruction silhouette of a window with a measured horizon profile. */
  private drawProfile(win: ViewWindow): void {
    const prof = win.profile!;
    const { ctx } = this;
    const leaf = leafOn(new Date(this.timeMs));
    const samples = sampleProfile(prof, leaf, 0.5);

    // Split into runs of equal kind.
    const runs: ProfileSample[][] = [];
    for (const s of samples) {
      const last = runs[runs.length - 1];
      if (last && last[0].kind === s.kind) last.push(s); else {
        // share the boundary sample so runs touch
        if (last) last.push(s);
        runs.push([s]);
      }
    }
    // deterministic soft irregularity for crowns
    const jit = (az: number) => 0.45 * Math.sin(az * 2.7) + 0.3 * Math.sin(az * 7.3 + 1.3) + 0.2 * Math.sin(az * 13.1);

    const tops = (run: ProfileSample[], f: (s: ProfileSample) => number, j: boolean): Array<[number, number]> =>
      run.map(s => [s.az, Math.max(0, f(s) + (j ? jit(s.az) : 0))]);
    const bottom = (run: ProfileSample[]): Array<[number, number]> =>
      [[run[run.length - 1].az, 0], [run[0].az, 0]];

    const fillRun = (top: Array<[number, number]>, base: Array<[number, number]>, style: string) => {
      ctx.beginPath(); this.pathPts(top, true); this.pathPts(base, false); ctx.closePath();
      ctx.fillStyle = style; ctx.fill();
    };
    const edge = (top: Array<[number, number]>, style: string, w: number, dash?: number[], glow?: string) => {
      ctx.beginPath(); this.pathPts(top, true);
      ctx.strokeStyle = style; ctx.lineWidth = w; ctx.setLineDash(dash ?? []);
      if (glow) { ctx.shadowColor = glow; ctx.shadowBlur = 5; }
      ctx.stroke(); ctx.shadowBlur = 0; ctx.setLineDash([]);
    };

    ctx.save();
    ctx.lineJoin = 'round';
    for (const run of runs) {
      const kind = run[0].kind;
      const base = bottom(run);
      if (kind === 'building') {
        const t = tops(run, s => s.top, false);
        fillRun(t, base, 'rgb(14,17,23)');
        edge(t, 'rgba(120,135,160,0.45)', 1.2);
      } else if (kind === 'estimated') {
        const t = tops(run, s => s.top, false);
        fillRun(t, base, 'rgba(34,42,56,0.62)');
        edge(t, 'rgba(160,175,200,0.7)', 1.3, [6, 5]);
      } else if (kind === 'conifer') {
        const t = tops(run, s => s.top, true);
        fillRun(t, base, 'rgb(9,20,15)');
        edge(t, 'rgba(60,110,80,0.55)', 2.2, undefined, 'rgba(40,90,60,0.8)');
      } else if (leaf) {
        const t = tops(run, s => s.leafTop, true);
        fillRun(t, base, 'rgb(11,24,17)');
        edge(t, 'rgba(70,125,80,0.55)', 2.4, undefined, 'rgba(50,100,60,0.8)');
      } else {
        // bare: solid roofline behind, see-through branches above it
        const rb = tops(run, s => s.bareTop, false);
        fillRun(rb, base, 'rgb(14,17,23)');
        edge(rb, 'rgba(120,135,160,0.45)', 1.2);
        const crown = tops(run, s => s.leafTop, true);
        const rev = rb.slice().reverse();
        ctx.beginPath(); this.pathPts(crown, true); this.pathPts(rev, false); ctx.closePath();
        ctx.fillStyle = 'rgba(14,26,18,0.34)'; ctx.fill();
        edge(crown, 'rgba(90,130,95,0.35)', 1.4, [2, 3]);
      }
    }

    // Walls at the east / west limits: bands of constant azimuth from horizon to zenith.
    const band = (a: number, b: number) => {
      const poly: Array<[number, number]> = [];
      for (let alt = 0; alt <= 90; alt += 3) poly.push([a, alt]);
      for (let alt = 90; alt >= 0; alt -= 3) poly.push([b, alt]);
      ctx.beginPath(); this.pathPts(poly, true); ctx.closePath();
      ctx.fillStyle = 'rgba(6,8,12,0.78)'; ctx.fill();
    };
    band(prof.azMin, prof.azMin + 2.5);
    band(prof.azMax - 2.5, prof.azMax);
    const wallEdge = (az: number) => {
      const line: Array<[number, number]> = [];
      for (let alt = 0; alt <= 90; alt += 3) line.push([az, alt]);
      ctx.beginPath(); this.pathPts(line, true);
      ctx.strokeStyle = 'rgba(120,135,160,0.4)'; ctx.lineWidth = 1; ctx.stroke();
    };
    wallEdge(prof.azMin + 2.5); wallEdge(prof.azMax - 2.5);
    ctx.restore();
  }

  private drawGround(): void {
    const { ctx, cam } = this;
    // Horizon = great circle with the zenith as pole. Its stereographic image is a circle.
    const zx = 0, zy = cam.u[2], zz = cam.f[2];
    ctx.fillStyle = 'rgba(8,10,14,0.97)';
    ctx.beginPath();
    if (Math.abs(zz) < 1e-3) {
      ctx.rect(-5, cam.H / 2, cam.W + 10, cam.H);
    } else {
      const S2 = 2 * cam.S;
      const cx = cam.W / 2 + S2 * zx / zz, cy = cam.H / 2 - S2 * zy / zz, R = S2 / Math.abs(zz);
      if (zz > 0) ctx.rect(-5, -5, cam.W + 10, cam.H + 10); // sky inside the circle, ground outside
      ctx.arc(cx, cy, R, 0, 6.2832);
    }
    ctx.fill('evenodd');
  }

  private drawHorizon(): void {
    const { ctx } = this;
    ctx.strokeStyle = 'rgba(150,175,210,0.55)';
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    this.traceAzAlt(az => [az, 0], 0, 360, 2);
    ctx.stroke();

    // Azimuth ticks every 15 degrees
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(150,175,210,0.45)';
    const { cam, tmp } = this;
    const p1 = [0, 0];
    for (let az = 0; az < 360; az += 5) {
      const big = az % 15 === 0;
      const [e0, n0, u0] = azAltToEnu(az, 0);
      const [e1, n1, u1] = azAltToEnu(az, big ? 1.8 : 0.9);
      if (!cam.project(e0, n0, u0, tmp)) continue;
      p1[0] = tmp[0]; p1[1] = tmp[1];
      if (!cam.project(e1, n1, u1, tmp)) continue;
      ctx.moveTo(p1[0], p1[1]); ctx.lineTo(tmp[0], tmp[1]);
    }
    ctx.stroke();

    // Cardinal / intercardinal labels, and degree labels on the ground
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let az = 0; az < 360; az += 15) {
      const card = az % 45 === 0;
      const [e, n, u] = azAltToEnu(az, card ? -3.2 : -3.2);
      if (!cam.project(e, n, u, tmp) || !this.onScreen(tmp[0], tmp[1], 10)) continue;
      if (card) {
        const major = az % 90 === 0;
        ctx.font = `${major ? 'bold 15' : '600 11'}px -apple-system, "Segoe UI", sans-serif`;
        ctx.fillStyle = major ? '#c9d6ea' : '#8da0bd';
        ctx.fillText(COMPASS[az / 45], tmp[0], tmp[1] + (major ? 5 : 2));
      } else {
        ctx.font = '9px monospace'; ctx.fillStyle = 'rgba(140,160,190,0.55)';
        ctx.fillText(`${az}°`, tmp[0], tmp[1]);
      }
    }
  }

  // ── labels ────────────────────────────────────────────────────────────────

  private label(text: string, x: number, y: number, style: { font: string; color: string; align?: CanvasTextAlign; alpha?: number }): boolean {
    if (style.alpha === 0) return false;
    const { ctx } = this;
    ctx.font = style.font;
    const w = ctx.measureText(text).width, h = 12;
    const align = style.align ?? 'left';
    const x0 = align === 'left' ? x : align === 'center' ? x - w / 2 : x - w;
    const rect: [number, number, number, number] = [x0 - 2, y - h / 2, x0 + w + 2, y + h / 2];
    for (const r of this.labelRects) {
      if (rect[0] < r[2] && rect[2] > r[0] && rect[1] < r[3] && rect[3] > r[1]) return false;
    }
    if (rect[0] < 0 || rect[2] > this.cam.W || rect[1] < 0 || rect[3] > this.cam.H) return false;
    this.labelRects.push(rect);
    ctx.textAlign = align; ctx.textBaseline = 'middle';
    ctx.globalAlpha = style.alpha ?? 1;
    ctx.fillStyle = style.color;
    ctx.fillText(text, x, y);
    ctx.globalAlpha = 1;
    return true;
  }

  private drawLabels(lim: number, win: ViewWindow | undefined): void {
    const { cam, tmp } = this;
    const date = new Date(this.timeMs);
    const inFrame = (az: number, alt: number) => {
      if (!win) return 1;
      const v = visibility(win, az, alt, date);
      return v === 'ok' ? 1 : v === 'blocked' && win.profile ? 0 : 0.5;
    };

    // Planets & Moon
    this.bodies.forEach(b => {
      if (b.alt < -1 || !cam.project(b.enu[0], b.enu[1], b.enu[2], tmp)) return;
      const off = b.name === 'Moon' ? 16 : 9;
      this.label(b.name, tmp[0] + off, tmp[1], { font: '600 12px -apple-system, "Segoe UI", sans-serif', color: b.color, alpha: inFrame(b.az, b.alt) });
    });

    // Asterism names
    for (const a of catalog.asterisms) {
      if (a.name === 'Pointers') continue;
      let sx = 0, sy = 0, c = 0, ok = true;
      const seen = new Set<number>();
      for (const p of a.paths) for (const i of p) {
        if (seen.has(i)) continue; seen.add(i);
        if (!this.drawn[i] || this.su[i] < 0) { ok = false; break; }
        sx += this.sx[i]; sy += this.sy[i]; c++;
      }
      if (!ok || !c) continue;
      this.label(a.name, sx / c, sy / c, { font: 'italic 11px -apple-system, "Segoe UI", sans-serif', color: '#9ccaff', align: 'center', alpha: 0.85 });
    }

    // Named stars (brightest first)
    const m = this.m;
    for (const [i, name] of catalog.names) {
      if (!this.drawn[i] || this.su[i] < 0) continue;
      if (catalog.mag[i] + this.horizonPenalty(this.su[i]) > lim) continue;
      const x = this.sx[i], y = this.sy[i];
      if (!this.onScreen(x, y, 0)) continue;
      const v = catalog.starVec;
      const { az, alt } = enuToAzAlt(
        m[0] * v[i * 3] + m[1] * v[i * 3 + 1] + m[2] * v[i * 3 + 2],
        m[3] * v[i * 3] + m[4] * v[i * 3 + 1] + m[5] * v[i * 3 + 2], this.su[i]);
      this.label(name, x + 6, y - 5, { font: '11px -apple-system, "Segoe UI", sans-serif', color: '#d7e1f2', alpha: 0.9 * inFrame(az, alt) });
    }

    // Constellation names (lowest priority)
    const rankMax = this.view.fov > 110 ? 2 : 3;
    for (const c of catalog.constellations) {
      if (c.rank > rankMax) continue;
      const x = c.vec[0], y = c.vec[1], z = c.vec[2];
      const e = m[0] * x + m[1] * y + m[2] * z, n = m[3] * x + m[4] * y + m[5] * z, u = m[6] * x + m[7] * y + m[8] * z;
      if (u < 0.03 || !cam.project(e, n, u, tmp) || !this.onScreen(tmp[0], tmp[1], -10)) continue;
      const { az, alt } = enuToAzAlt(e, n, u);
      this.label(c.name.toUpperCase(), tmp[0], tmp[1], { font: '10px -apple-system, "Segoe UI", sans-serif', color: '#7f95b8', align: 'center', alpha: 0.7 * inFrame(az, alt) });
    }
  }

  private drawSelection(): void {
    const pos = this.selectionScreenPos();
    if (!pos) return;
    const { ctx } = this;
    ctx.strokeStyle = '#58a6ff'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(pos[0], pos[1], 13, 0, 6.2832); ctx.stroke();
  }

  private selectionScreenPos(): [number, number] | null {
    const s = this.selected;
    if (!s) return null;
    if (s.kind === 'star') return this.drawn[s.i] ? [this.sx[s.i], this.sy[s.i]] : null;
    const b = this.bodies[s.i];
    return this.cam.project(b.enu[0], b.enu[1], b.enu[2], this.tmp) ? [this.tmp[0], this.tmp[1]] : null;
  }

  // ── input ─────────────────────────────────────────────────────────────────

  private attachInput(): void {
    const c = this.canvas;
    const pts = new Map<number, { x: number; y: number }>();
    let moved = false, downT = 0, downX = 0, downY = 0;
    let pinchD0 = 0, pinchFov0 = 100;
    let lastTapT = 0, lastTapX = 0, lastTapY = 0;
    const rel = (e: PointerEvent) => { const r = c.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const dist = () => { const [a, b] = [...pts.values()]; return Math.hypot(a.x - b.x, a.y - b.y) || 1; };

    c.addEventListener('pointerdown', e => {
      c.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, rel(e));
      if (pts.size === 1) { moved = false; downT = performance.now(); ({ x: downX, y: downY } = rel(e)); }
      else if (pts.size === 2) { moved = true; pinchD0 = dist(); pinchFov0 = this.view.fov; }
      e.preventDefault();
    });

    c.addEventListener('pointermove', e => {
      const prev = pts.get(e.pointerId);
      if (!prev) return;
      const cur = rel(e);
      pts.set(e.pointerId, cur);
      if (pts.size === 1) {
        if (!moved && Math.hypot(cur.x - downX, cur.y - downY) > 6) moved = true;
        if (moved) {
          const k = this.cam.radPerPx / D2R;
          const ca = Math.max(Math.cos(this.view.alt * D2R), 0.3);
          this.setView({ az: this.view.az - (cur.x - prev.x) * k / ca, alt: this.view.alt + (cur.y - prev.y) * k });
        }
      } else if (pts.size === 2) {
        this.setView({ fov: pinchFov0 * pinchD0 / dist() });
      }
    });

    const up = (e: PointerEvent) => {
      if (!pts.has(e.pointerId)) return;
      const wasSingle = pts.size === 1;
      const p = rel(e);
      pts.delete(e.pointerId);
      if (pts.size === 1) {
        // pinch ended: continue panning from the remaining finger without a jump
        moved = true;
      }
      if (wasSingle && !moved && e.type === 'pointerup' && performance.now() - downT < 500) {
        const now = performance.now();
        if (now - lastTapT < 320 && Math.hypot(p.x - lastTapX, p.y - lastTapY) < 30) {
          this.select(null); this.resetView(); lastTapT = 0;
        } else {
          this.handleTap(p.x, p.y);
          lastTapT = now; lastTapX = p.x; lastTapY = p.y;
        }
      }
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener('dblclick', () => { this.select(null); this.resetView(); });

    c.addEventListener('wheel', e => {
      e.preventDefault();
      this.setView({ fov: this.view.fov * Math.exp(e.deltaY * 0.0012) });
    }, { passive: false });
    c.addEventListener('contextmenu', e => e.preventDefault());
  }

  // ── tap for info ──────────────────────────────────────────────────────────

  private handleTap(x: number, y: number): void {
    let best: Hit | null = null, bestD = 22;
    for (const h of this.hits) {
      const d = Math.hypot(h.x - x, h.y - y) - h.bias;
      if (d < bestD) { bestD = d; best = h; }
    }
    this.select(best ? best.sel : null);
  }

  private select(s: Selection): void {
    this.selected = s;
    this.refreshInfo();
    this.requestRender();
  }

  private windowSpans(key: string, samples: () => Sample[], w: ViewWindow): string {
    let s = this.spanCache.get(key);
    if (!s) { s = samples(); this.spanCache.set(key, s); }
    const marked: Sample[] = s.map(q => ({ ...q, visible: isVisible(w, q.azimuth, q.altitude, q.time.date), window: w.label }));
    const spans = findVisSpans(marked);
    return spans.length ? spans.map(sp => `${fmtTime(sp.start)}–${fmtTime(sp.end)}`).join(', ') : '';
  }

  private refreshInfo(): void {
    const el = this.infoEl;
    const s = this.selected;
    if (!s) { el.classList.add('hidden'); el.innerHTML = ''; return; }

    let title: string, sub = '', mag: number, az: number, alt: number, extra = '';
    let key: string, getSamples: () => Sample[];
    if (s.kind === 'star') {
      const i = s.i, a = this.starAltAz(i);
      az = a.az; alt = a.alt; mag = catalog.mag[i];
      const conId = catalog.con[i], conN = catalog.conName.get(conId) ?? conId;
      const name = catalog.names.get(i);
      const bay = [catalog.des[i], conId].filter(Boolean).join(' ');
      title = name ?? `${conN} · HIP ${catalog.hip[i]}`;
      sub = name ? [bay, conN, `HIP ${catalog.hip[i]}`].filter(Boolean).join(' · ') : bay;
      const v: [number, number, number] = [catalog.starVec[i * 3], catalog.starVec[i * 3 + 1], catalog.starVec[i * 3 + 2]];
      key = `s${i}`;
      getSamples = () => this.night ? sampleFixedStar(v, this.night) : [];
    } else {
      const b = this.bodies[s.i];
      az = b.az; alt = b.alt; mag = b.mag; title = b.name;
      if (b.name === 'Moon') {
        const frac = (1 - Math.cos(this.moonElong * D2R)) / 2;
        sub = `${moonPhaseText(this.moonElong)} · ${(frac * 100).toFixed(0)}% lit`;
      }
      key = `b${s.i}`;
      getSamples = () => this.data[s.i]?.samples ?? [];
    }

    const win = config.windows[this.winIdx];
    let when = '';
    if (win && this.night) {
      const here = this.windowSpans(`${key}|${win.label}`, getSamples, win);
      if (here) when = `<span class="ok">${win.label} window tonight: ${here}</span>`;
      else {
        const others = config.windows.filter(w => w !== win)
          .map(w => ({ w, t: this.windowSpans(`${key}|${w.label}`, getSamples, w) })).filter(o => o.t);
        when = others.length
          ? `Not in the ${win.label} window tonight &mdash; ${others.map(o => `${o.w.label}: ${o.t}`).join('; ')}`
          : `Not in any window tonight`;
      }
    }
    const vis = win ? visibility(win, az, alt, new Date(this.timeMs)) : 'ok';
    const state = alt < 0 ? 'below horizon'
      : vis === 'outside' ? 'outside window'
      : vis === 'blocked' ? (win?.profile ? 'behind obstruction' : 'too low') : '';
    el.classList.remove('hidden');
    el.innerHTML = `
      <button class="sky-info__close" aria-label="Close">&times;</button>
      <div class="sky-info__title">${title}</div>
      ${sub ? `<div class="sky-info__sub">${sub}</div>` : ''}
      <div class="sky-info__row">mag ${mag.toFixed(1)} &middot; alt ${alt.toFixed(0)}&deg; &middot; az ${az.toFixed(0)}&deg; ${compassName(az)}${state ? ` &middot; <em>${state}</em>` : ''}</div>
      ${when ? `<div class="sky-info__row">${when}</div>` : ''}`;
  }
}
