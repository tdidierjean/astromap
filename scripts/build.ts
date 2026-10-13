// Build: bundle the app, then generate sw.js with a content-hash cache version.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dir, '..');
const r = Bun.spawnSync(['bun', 'build', 'src/main.ts', '--outfile', 'dist/main.js', '--target', 'browser', '--format', 'iife'], { cwd: root, stdout: 'inherit', stderr: 'inherit' });
if (r.exitCode !== 0) process.exit(r.exitCode ?? 1);

const files = ['index.html', 'dist/main.js', 'src/style.css', 'manifest.webmanifest',
  ...readdirSync(join(root, 'icons')).filter(f => f.endsWith('.png')).sort().map(f => `icons/${f}`),
  'scripts/sw.template.js'];
const h = createHash('sha256');
for (const f of files) h.update(f).update(readFileSync(join(root, f)));
const version = h.digest('hex').slice(0, 12);
writeFileSync(join(root, 'sw.js'), readFileSync(join(root, 'scripts/sw.template.js'), 'utf8').replaceAll('__VERSION__', version));
console.log(`sw.js written (cache astromap-${version})`);
