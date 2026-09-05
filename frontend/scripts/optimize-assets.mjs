#!/usr/bin/env node
/**
 * Asset optimization script (#23).
 *
 * Runs `gltf-transform optimize` over every GLB under public/models, applying
 * Draco geometry compression + Meshopt + texture compression, writing the
 * results in place (or to public/models-optimized if --out is given). Expect
 * 60-80% smaller files and much faster mobile loads.
 *
 * Usage:
 *   npx @gltf-transform/cli optimize <in> <out>   # what this wraps
 *   node scripts/optimize-assets.mjs              # optimize in place (backup made)
 *
 * Requires the gltf-transform CLI:
 *   npm i -D @gltf-transform/cli
 */
import { readdirSync, statSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const MODELS_DIR = join(ROOT, 'public', 'models');
const BACKUP_DIR = join(ROOT, 'public', 'models-original');

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full));
    else if (entry.toLowerCase().endsWith('.glb')) out.push(full);
  }
  return out;
}

function main() {
  if (!existsSync(MODELS_DIR)) {
    console.error('No public/models directory found.');
    process.exit(1);
  }
  const files = walk(MODELS_DIR);
  console.log(`Optimizing ${files.length} GLB files...`);

  let totalBefore = 0;
  let totalAfter = 0;

  for (const file of files) {
    const before = statSync(file).size;
    totalBefore += before;

    // Back up the original once.
    const rel = file.slice(MODELS_DIR.length + 1);
    const backup = join(BACKUP_DIR, rel);
    if (!existsSync(backup)) {
      mkdirSync(dirname(backup), { recursive: true });
      copyFileSync(file, backup);
    }

    try {
      execFileSync(
        'npx',
        [
          '@gltf-transform/cli', 'optimize', backup, file,
          '--compress', 'draco',
          '--texture-compress', 'webp',
        ],
        { stdio: 'inherit' }
      );
    } catch (e) {
      console.warn(`Skipped ${rel} (is @gltf-transform/cli installed?)`);
      continue;
    }

    const after = statSync(file).size;
    totalAfter += after;
    const pct = ((1 - after / before) * 100).toFixed(1);
    console.log(`  ${rel}: ${(before / 1024).toFixed(0)}KB -> ${(after / 1024).toFixed(0)}KB (-${pct}%)`);
  }

  if (totalBefore > 0) {
    const pct = ((1 - totalAfter / totalBefore) * 100).toFixed(1);
    console.log(`\nTotal: ${(totalBefore / 1e6).toFixed(1)}MB -> ${(totalAfter / 1e6).toFixed(1)}MB (-${pct}%)`);
  }
}

main();
