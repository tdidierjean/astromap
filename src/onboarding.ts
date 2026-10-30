// First-run onboarding: a full-screen overlay that sets up the place (step 1) and the first window (step 2).
import { config, saveConfig, deviceTz } from './config';
import { COMPASS16, pointAz, newSimpleWindow, rangeHint } from './windows';
import { round2, formatCoords, parseLat, parseLon, searchPlaces, lookupElevation, type Place } from './location';
import { enterDemo } from './demo-mode';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};
const button = (text: string, cls: string, onClick: () => void): HTMLButtonElement => {
  const b = el('button', `ob-btn ${cls}`.trim(), text);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
};
const field = (label: string, input: HTMLElement): HTMLElement => {
  const s = el('div', 'ob-section');
  s.append(el('div', 'ob-label', label), input);
  return s;
};

/** Show the overlay. Saving the config reloads the page, so the normal start-up runs with the new data. */
export function startOnboarding(): void {
  const root = el('div', 'onboarding');
  root.setAttribute('role', 'dialog'); root.setAttribute('aria-label', 'Set up AstroMap');
  document.body.append(root);
  const card = el('div', 'onboarding__card');
  root.append(card);
  const place = { elev: 0, tz: deviceTz() };
  let chosen: Place | null = null;

  const show = (...nodes: HTMLElement[]) => { card.replaceChildren(...nodes); root.scrollTop = 0; };

  function stepLocation(): void {
    const msg = el('div', 'ob-msg');
    const setMsg = (t: string, err = false) => { msg.textContent = t; msg.classList.toggle('ob-msg--err', err); };
    const lat = el('input', 'ob-input'), lon = el('input', 'ob-input'), name = el('input', 'ob-input');
    for (const i of [lat, lon]) { i.type = 'text'; i.inputMode = 'decimal'; i.autocomplete = 'off'; }
    lat.placeholder = 'Latitude, e.g. 50.74'; lon.placeholder = 'Longitude, e.g. 7.12';
    lat.setAttribute('aria-label', 'Latitude'); lon.setAttribute('aria-label', 'Longitude');
    name.type = 'text'; name.maxLength = 80; name.placeholder = 'Name (optional)'; name.setAttribute('aria-label', 'Place name'); name.autocomplete = 'off';
    const next = button('Continue', 'ob-btn--primary', () => {
      const la = parseLat(lat.value), lo = parseLon(lon.value);
      if (la === null || lo === null) { setMsg('Latitude must be between -90 and 90, longitude between -180 and 180.', true); return; }
      chosen = { name: name.value.trim(), lat: round2(la), lon: round2(lo), elev: place.elev, tz: place.tz };
      stepWindow();
    });
    // Editing the numbers by hand invalidates the elevation / zone that came with a search result.
    for (const i of [lat, lon]) i.addEventListener('input', () => { place.elev = 0; place.tz = deviceTz(); });
    const fill = (p: Place, note: string) => {
      lat.value = String(p.lat); lon.value = String(p.lon); name.value = p.name; place.elev = p.elev; place.tz = p.tz;
      setMsg(note);
    };

    const demo = button('Just look around: try the demo', 'ob-btn--demo', enterDemo);

    const geo = button('Use my location', '', () => {
      if (!navigator.geolocation) { setMsg('Location is not available here. Search or type the coordinates below.', true); return; }
      geo.disabled = true; setMsg('Locating…');
      navigator.geolocation.getCurrentPosition(async pos => {
        const la = round2(pos.coords.latitude), lo = round2(pos.coords.longitude);
        const elev = await lookupElevation(la, lo);
        geo.disabled = false;
        fill({ name: '', lat: la, lon: lo, elev, tz: deviceTz() }, `Found you at ${formatCoords(la, lo)}, rounded to about 1 km.`);
      }, () => {
        geo.disabled = false;
        setMsg('Could not get your location. Search or type the coordinates below.', true);
      }, { timeout: 15000, maximumAge: 600000 });
    });

    const q = el('input', 'ob-input');
    q.type = 'search'; q.placeholder = 'City or village'; q.autocomplete = 'off'; q.setAttribute('aria-label', 'Search a place');
    const hits = el('div', 'ob-hits');
    let token = 0;
    const search = async () => {
      const text = q.value.trim();
      if (!text) return;
      const mine = ++token;
      hits.replaceChildren(); setMsg('Searching…');
      try {
        const res = await searchPlaces(text, (navigator.language || 'en').split('-')[0], deviceTz());
        if (mine !== token) return;
        if (!res.length) { setMsg('No match. Try another spelling, or type the coordinates below.', true); return; }
        setMsg('');
        hits.replaceChildren(...res.map(h => button(h.detail, 'ob-hit', () => {
          fill(h, `${h.detail}: ${formatCoords(h.lat, h.lon)}, ${h.elev} m, ${h.tz}`);
          hits.replaceChildren();
        })));
      } catch {
        if (mine === token) setMsg('Search is unavailable (offline?). Type the coordinates below instead.', true);
      }
    };
    q.addEventListener('keydown', e => { if (e.key === 'Enter') void search(); });
    const go = button('Search', '', () => void search());
    const qrow = el('div', 'ob-row'); qrow.append(q, go);
    const crow = el('div', 'ob-row'); crow.append(lat, lon);

    show(
      el('h2', '', 'Welcome to AstroMap'),
      el('p', '', 'See what the night sky offers from your own window. First, where are you?'),
      demo,
      field('Your location', geo),
      field('Or search a place', qrow), hits,
      field('Or enter coordinates', crow), name,
      msg, next,
    );
  }

  function stepWindow(): void {
    const p = chosen!;
    const base = newSimpleWindow([], p.lat);
    let az = base.azCenter, half = base.halfWidth;
    const name = el('input', 'ob-input');
    name.type = 'text'; name.value = 'Window'; name.maxLength = 40; name.autocomplete = 'off'; name.setAttribute('aria-label', 'Window name');

    const compass = el('div', 'ob-compass');
    const dirs = COMPASS16.filter((_, i) => i % 2 === 0); // N, NE, E, SE, S, SW, W, NW
    const dirBtns = dirs.map((d, k) => {
      const b = button(d, '', () => { az = pointAz(k * 2); sync(); });
      b.setAttribute('aria-label', `Faces ${d}`);
      compass.append(b);
      return b;
    });
    const width = el('input'); width.type = 'range'; width.min = '5'; width.max = '90'; width.step = '5'; width.value = String(half);
    width.setAttribute('aria-label', 'Window width');
    const widthVal = el('span', 'settings-val');
    const hint = el('div', 'ob-note');
    const sync = () => {
      dirBtns.forEach((b, k) => b.classList.toggle('active', pointAz(k * 2) === az));
      widthVal.textContent = `±${half}°`;
      hint.textContent = `Sees from ${rangeHint(az, half).replace(' – ', ' to ')} (about ${half * 2}° wide).`;
    };
    width.addEventListener('input', () => { half = Number(width.value); sync(); });
    sync();
    const wrow = el('div', 'ob-range'); wrow.append(width, widthVal);

    const finish = (withWindow: boolean) => {
      Object.assign(config, { name: p.name, lat: p.lat, lon: p.lon, elev: p.elev, tz: p.tz });
      config.windows = withWindow ? [{ ...base, label: name.value.trim() || 'Window', azCenter: az, halfWidth: half }] : [];
      saveConfig();
      location.reload();
    };

    const foot = el('div', 'ob-footer');
    foot.append(
      button('Start', 'ob-btn--primary', () => finish(true)),
      el('p', 'ob-note', 'Trees and buildings in the way can be added later: you can refine the horizon of each window in Settings.'),
      button('Skip for now', 'ob-link', () => finish(false)),
      button('Back', 'ob-link', stepLocation),
    );
    show(
      el('h2', '', 'Your first window'),
      el('p', '', `Which way does the window you'll watch from face? (${p.name || formatCoords(p.lat, p.lon)})`),
      field('Name', name),
      field('Faces', compass),
      field('Width', wrow), hint,
      foot,
    );
  }

  stepLocation();
}
