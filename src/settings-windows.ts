// Settings: the editable list of viewing windows (one card per window).
import { config, saveConfig, DEFAULT_CONFIG, type ViewWindow } from './config';
import {
  COMPASS16, pointAz, pointIndex, parseDegrees, rangeHint, newSimpleWindow, seedFromProfile, moveWindow,
} from './windows';

let onChange: (id?: string) => void = () => {};
let onFacing: (id: string) => void = () => {};

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};
const btn = (text: string, label: string, onClick: () => void, cls = 'settings-btn'): HTMLButtonElement => {
  const b = el('button', cls, text);
  b.type = 'button'; b.title = label; b.setAttribute('aria-label', label);
  b.addEventListener('click', onClick);
  return b;
};

/** Persist and refresh pills / sky view / Plan tab. */
function commit(id?: string): void { saveConfig(); onChange(id); }

function cardFor(w: ViewWindow, i: number): HTMLElement {
  const card = el('div', 'settings-group win-card');
  card.dataset.id = w.id;

  const name = el('input', 'settings-input win-card__name');
  name.type = 'text'; name.value = w.label; name.maxLength = 40; name.autocomplete = 'off';
  name.setAttribute('aria-label', 'Window name');
  name.addEventListener('change', () => {
    w.label = name.value.trim() || w.label;
    name.value = w.label;
    commit();
  });
  card.append(name);

  if (w.profile) {
    const p = w.profile;
    card.append(el('div', 'settings-hint', `Horizon: ${p.source} (${p.azMin}°–${p.azMax}°)`));
    card.append(btn('Reset to simple window', 'Reset to simple window', () => {
      Object.assign(w, seedFromProfile(p));
      w.profile = undefined; w.profileOptOut = true;
      commit(w.id); onFacing(w.id); renderWindowList(w.id, '.win-reset');
    }, 'settings-btn win-reset'));
  } else {
    // Facing: compass select + degrees, kept in sync
    const sel = el('select', 'settings-input win-card__facing');
    sel.setAttribute('aria-label', 'Faces');
    COMPASS16.forEach((c, k) => { const o = el('option', '', c); o.value = String(k); sel.append(o); });
    const custom = el('option', '', 'Custom'); custom.value = 'custom'; sel.append(custom);
    const deg = el('input', 'settings-input win-card__deg');
    deg.type = 'number'; deg.min = '0'; deg.max = '359'; deg.step = '1'; deg.setAttribute('aria-label', 'Facing in degrees');
    const half = el('input', 'settings-range'); half.type = 'range'; half.min = '5'; half.max = '90'; half.step = '5';
    half.setAttribute('aria-label', 'Half width');
    const halfVal = el('span', 'settings-val');
    const hint = el('div', 'settings-hint');

    const syncFacing = () => {
      const k = pointIndex(w.azCenter);
      sel.value = k >= 0 ? String(k) : 'custom';
      deg.value = String(w.azCenter);
      hint.textContent = rangeHint(w.azCenter, w.halfWidth);
    };
    const setAz = (az: number) => { w.azCenter = az; syncFacing(); commit(w.id); onFacing(w.id); };
    sel.addEventListener('change', () => { if (sel.value !== 'custom') setAz(pointAz(Number(sel.value))); });
    deg.addEventListener('change', () => {
      const v = parseDegrees(deg.value);
      if (v === null) { syncFacing(); return; }
      setAz(v);
    });
    half.addEventListener('input', () => {
      w.halfWidth = Number(half.value);
      halfVal.textContent = `±${w.halfWidth}°`;
      hint.textContent = rangeHint(w.azCenter, w.halfWidth);
      commit(w.id);
    });
    half.value = String(w.halfWidth); halfVal.textContent = `±${w.halfWidth}°`;
    syncFacing();

    const faces = el('label', 'settings-field', 'Faces');
    faces.append(sel, deg, el('span', '', '°'));
    const row = el('div', 'settings-row'); row.append(half, halfVal);
    card.append(faces, row, hint);

    // Built-in measured horizon (matched by id) can be brought back after a reset
    const builtin = DEFAULT_CONFIG.windows.find(d => d.id === w.id && d.profile);
    if (builtin && w.profileOptOut) {
      card.append(btn('Restore measured horizon', 'Restore measured horizon', () => {
        w.profile = structuredClone(builtin.profile); w.profileOptOut = false;
        w.azCenter = builtin.azCenter; w.halfWidth = builtin.halfWidth;
        commit(w.id); onFacing(w.id); renderWindowList(w.id, '.win-restore');
      }, 'settings-btn win-restore'));
    }
  }

  const acts = el('div', 'settings-row win-card__actions');
  const up = btn('↑', 'Move up', () => { if (moveWindow(config.windows, w.id, -1)) { commit(); renderWindowList(w.id, '.win-up'); } }, 'settings-btn win-up');
  const down = btn('↓', 'Move down', () => { if (moveWindow(config.windows, w.id, 1)) { commit(); renderWindowList(w.id, '.win-down'); } }, 'settings-btn win-down');
  up.disabled = i === 0; down.disabled = i === config.windows.length - 1;
  const del = btn('Delete', 'Delete window', () => {
    const msg = w.profile ? `Delete "${w.label}"? Its measured horizon will be lost.` : `Delete "${w.label}"?`;
    if (!confirm(msg)) return;
    config.windows.splice(config.windows.indexOf(w), 1);
    commit(); renderWindowList();
  }, 'settings-btn win-del');
  del.disabled = config.windows.length <= 1;
  acts.append(up, down, del);
  card.append(acts);
  return card;
}

/** Rebuild the list from config. `focusId` + `sel` re-focus a control of that card afterwards. */
export function renderWindowList(focusId?: string, sel?: string): void {
  const box = document.getElementById('win-list');
  if (!box) return;
  box.replaceChildren(...config.windows.map(cardFor));
  if (!config.windows.length) box.append(el('div', 'settings-hint', 'No windows — add one below'));
  if (focusId && sel) {
    const card = [...box.children].find(c => (c as HTMLElement).dataset.id === focusId);
    const t = card?.querySelector<HTMLElement>(`${sel}:not(:disabled)`) ?? card?.querySelector<HTMLElement>('button:not(:disabled)');
    t?.focus({ preventScroll: true });
  }
}

/** @param refresh  re-render pills, sky view and Plan tab
 *  @param recentre called with a window id after its facing changed (the sky view re-centres if it shows it) */
export function setupWindowList(refresh: () => void, recentre: (id: string) => void): void {
  onChange = refresh; onFacing = recentre;
  document.getElementById('win-add')!.addEventListener('click', () => {
    const w = newSimpleWindow(config.windows, config.lat);
    config.windows.push(w);
    commit(w.id); renderWindowList();
    const input = document.querySelector<HTMLInputElement>(`#win-list [data-id="${w.id}"] .win-card__name`);
    input?.focus(); input?.select();
  });
  renderWindowList();
}
