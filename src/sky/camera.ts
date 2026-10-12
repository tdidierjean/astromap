// Stereographic camera. Works on (east, north, up) unit vectors.
const D2R = Math.PI / 180;

export interface View { az: number; alt: number; fov: number; }

export const FOV_MIN = 20;
export const FOV_MAX = 150;
export const ALT_MIN = -10;
export const ALT_MAX = 90;

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

export class Camera {
  /** Canvas size in CSS pixels. */
  W = 1; H = 1;
  /** Pixels per unit of the stereographic plane (x = 2 tan(theta/2)). */
  S = 1;
  // Camera basis in ENU: right, up, forward
  r: [number, number, number] = [1, 0, 0];
  u: [number, number, number] = [0, 0, 1];
  f: [number, number, number] = [0, 1, 0];
  view: View = { az: 0, alt: 30, fov: 100 };

  set(view: View, W: number, H: number): void {
    this.view = { ...view };
    this.W = W; this.H = H;
    const az = view.az * D2R, alt = view.alt * D2R;
    const ca = Math.cos(alt);
    this.f = [Math.sin(az) * ca, Math.cos(az) * ca, Math.sin(alt)];
    this.r = [Math.cos(az), -Math.sin(az), 0];
    const [rx, ry] = this.r, [fx, fy, fz] = this.f;
    this.u = [ry * fz, -rx * fz, rx * fy - ry * fx];
    this.S = (W / 2) / (2 * Math.tan(view.fov * D2R / 4));
  }

  /**
   * Project an ENU unit vector. Returns false when it is too close to the
   * antipode of the view direction. Writes screen coords into out[0], out[1].
   */
  project(e: number, n: number, u: number, out: Float64Array | number[]): boolean {
    const pz = e * this.f[0] + n * this.f[1] + u * this.f[2];
    if (pz < -0.92) return false;
    const k = 2 * this.S / (1 + pz);
    out[0] = this.W / 2 + k * (e * this.r[0] + n * this.r[1] + u * this.r[2]);
    out[1] = this.H / 2 - k * (e * this.u[0] + n * this.u[1] + u * this.u[2]);
    return true;
  }

  /** Like project() but never fails: for polygons that must stay closed (coordinates may be huge). */
  projectClamped(e: number, n: number, u: number, out: Float64Array | number[]): void {
    let pz = e * this.f[0] + n * this.f[1] + u * this.f[2];
    if (pz < -0.985) pz = -0.985;
    const k = 2 * this.S / (1 + pz);
    out[0] = this.W / 2 + k * (e * this.r[0] + n * this.r[1] + u * this.r[2]);
    out[1] = this.H / 2 - k * (e * this.u[0] + n * this.u[1] + u * this.u[2]);
  }

  /** Inverse of project(): screen position -> ENU unit vector. */
  unproject(x: number, y: number): [number, number, number] {
    const px = (x - this.W / 2) / this.S, py = -(y - this.H / 2) / this.S;
    const rho2 = px * px + py * py;
    // plane radius = 2 tan(theta/2)  ->  cos(theta) = (4 - rho2)/(4 + rho2), cam_xy = 4 p/(4 + rho2)
    const cz = (4 - rho2) / (4 + rho2), cx = 4 * px / (4 + rho2), cy = 4 * py / (4 + rho2);
    return [
      cx * this.r[0] + cy * this.u[0] + cz * this.f[0],
      cx * this.r[1] + cy * this.u[1] + cz * this.f[1],
      cx * this.r[2] + cy * this.u[2] + cz * this.f[2],
    ];
  }

  /** Radians per screen pixel at the view centre. */
  get radPerPx(): number { return 1 / this.S; }
}

/** Altitude that puts the horizon at `frac` of the canvas height from the top (0.92 => near the bottom). */
export function altForHorizon(fov: number, W: number, H: number, frac = 0.92): number {
  const y = (frac - 0.5) * H;
  const t = y * 2 * Math.tan(fov * D2R / 4) / W; // tan(alt/2)
  return clamp(2 * Math.atan(t) / D2R, 0, 75);
}

/**
 * Default framing for a canvas: the horizon at the view-centre azimuth sits `hFrac` of the way down
 * (0.93 = ~7% above the bottom) and the top edge shows altitude `topAlt`. Derived from the canvas aspect.
 */
export function defaultFraming(W: number, H: number, hFrac = 0.93, topAlt = 74): { alt: number; fov: number } {
  const want = (hFrac - 0.5) / 0.5; // tan(alt/2) / tan((top-alt)/2)
  let lo = 0, hi = topAlt;
  for (let i = 0; i < 40; i++) {
    const x = (lo + hi) / 2;
    const f = Math.tan(x * D2R / 2) / Math.tan((topAlt - x) * D2R / 2);
    if (f < want) lo = x; else hi = x;
  }
  const alt = (lo + hi) / 2;
  const S = (hFrac - 0.5) * H / (2 * Math.tan(alt * D2R / 2));
  const fov = clamp(4 * Math.atan((W / 2) / (2 * S)) / D2R, 50, FOV_MAX);
  return { alt: altForHorizon(fov, W, H, hFrac), fov };
}
