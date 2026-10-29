// Rebuilds the brace: runs blender/build_brace.py headless, producing the .blend source, the GLB in
// public/models and the validation renders. Set BLENDER=/path/to/blender to override discovery.
//   npm run model:build             (with renders)
//   npm run model:build -- --no-render
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function findBlender() {
  if (process.env.BLENDER) return process.env.BLENDER;
  const candidates = [];
  if (process.platform === 'win32') {
    const base = 'C:/Program Files/Blender Foundation';
    if (existsSync(base)) {
      for (const d of readdirSync(base).sort().reverse()) candidates.push(join(base, d, 'blender.exe'));
    }
  } else if (process.platform === 'darwin') {
    candidates.push('/Applications/Blender.app/Contents/MacOS/Blender');
  }
  candidates.push('blender');
  return candidates.find((c) => c === 'blender' || existsSync(c));
}

const blender = findBlender();
const extra = process.argv.slice(2);
console.log(`[model] using ${blender}`);
const r = spawnSync(
  blender,
  ['-b', '--factory-startup', '--python', join(root, 'blender/build_brace.py'), '--', ...extra],
  { stdio: 'inherit', cwd: root },
);
process.exit(r.status ?? 1);
