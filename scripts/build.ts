// Build: bundle the app, then assemble _site/ (exactly the files in scripts/site-files.ts) with a generated sw.js
// whose precache list and cache version derive from that same list.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, rmSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, dirname, normalize } from 'node:path';
import { SITE_FILES } from './site-files';

const root = join(import.meta.dir, '..');
const fail = (msg: string): never => { console.error(`build error: ${msg}`); process.exit(1); };

const r = Bun.spawnSync(['bun', 'build', 'src/main.ts', '--outfile', 'dist/main.js', '--target', 'browser', '--format', 'iife'], { cwd: root, stdout: 'inherit', stderr: 'inherit' });
if (r.exitCode !== 0) process.exit(r.exitCode ?? 1);

// 1. every listed file must exist
const missing = SITE_FILES.filter(f => !existsSync(join(root, f)));
if (missing.length) fail(`files listed in scripts/site-files.ts are missing: ${missing.join(', ')}`);

// 2. guard: local references from index.html and the manifest must be in the list
const isLocal = (u: string) => !/^([a-z][a-z0-9+.-]*:|\/\/|#|data:)/i.test(u);
const clean = (u: string) => normalize(u.split(/[?#]/)[0].replace(/^\.\//, ''));
const refs = new Map<string, string>(); // file -> where referenced
const html = readFileSync(join(root, 'index.html'), 'utf8');
for (const m of html.matchAll(/\b(?:href|src)\s*=\s*"([^"]*)"/g)) if (isLocal(m[1]) && m[1] !== '') refs.set(clean(m[1]), 'index.html');
const manifest = JSON.parse(readFileSync(join(root, 'manifest.webmanifest'), 'utf8'));
for (const ic of manifest.icons ?? []) if (isLocal(ic.src)) refs.set(clean(ic.src), 'manifest.webmanifest');
const unlisted = [...refs].filter(([f]) => !SITE_FILES.includes(f));
if (unlisted.length) fail(`referenced but not in scripts/site-files.ts: ${unlisted.map(([f, w]) => `${f} (from ${w})`).join(', ')}`);
for (const f of SITE_FILES) if (!refs.has(f) && f !== 'index.html') console.warn(`warning: ${f} is published but not referenced by index.html or the manifest`);

// 3. service worker from the template: precache = './' + the list; version = hash of exactly those files
const template = readFileSync(join(root, 'scripts/sw.template.js'), 'utf8');
const h = createHash('sha256');
for (const f of SITE_FILES) h.update(f).update(readFileSync(join(root, f)));
h.update(template);
const version = h.digest('hex').slice(0, 12);
const sw = template.replaceAll('__VERSION__', version).replace('__PRECACHE__', JSON.stringify(['./', ...SITE_FILES]));

// 4. write _site/
const out = join(root, '_site');
rmSync(out, { recursive: true, force: true });
for (const f of SITE_FILES) {
  mkdirSync(dirname(join(out, f)), { recursive: true });
  copyFileSync(join(root, f), join(out, f));
}
writeFileSync(join(out, 'sw.js'), sw);
writeFileSync(join(out, '.nojekyll'), '');
console.log(`_site/ written: ${SITE_FILES.length} files + sw.js (cache astromap-${version})`);
