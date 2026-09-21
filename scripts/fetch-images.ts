/**
 * Downloads each pinned Unsplash photo once, converts it to WebP, and writes it
 * to public/products/. Those files are committed, so this only ever needs to run
 * when a photo ID is added or replaced.
 *
 *   pnpm images:fetch
 *
 * A `FAIL` line means that photo ID no longer resolves — replace it in
 * db/seed/images.ts and re-run. Already-present files are skipped, so re-running
 * is cheap and safe.
 */
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import sharp from 'sharp';
import { PHOTO_IDS } from '../db/seed/images';

const OUT_DIR = 'public/products';
const WIDTH = 800;
const HEIGHT = 600;

mkdirSync(OUT_DIR, { recursive: true });

let fetched = 0;
let skipped = 0;
let failed = 0;

for (const [slug, photoId] of Object.entries(PHOTO_IDS)) {
  const dest = `${OUT_DIR}/${slug}.webp`;

  if (existsSync(dest)) {
    skipped += 1;
    continue;
  }

  const url = `https://images.unsplash.com/${photoId}?w=1200&q=85&fm=jpg&fit=crop`;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`FAIL ${slug}: HTTP ${res.status} — ${url}`);
      failed += 1;
      continue;
    }

    const webp = await sharp(Buffer.from(await res.arrayBuffer()))
      .resize(WIDTH, HEIGHT, { fit: 'cover', position: 'centre' })
      .webp({ quality: 82 })
      .toBuffer();

    writeFileSync(dest, webp);
    fetched += 1;
    console.log(`ok   ${slug} (${Math.round(webp.length / 1024)}kB)`);
  } catch (error) {
    console.error(`FAIL ${slug}: ${(error as Error).message}`);
    failed += 1;
  }
}

console.log(`\nfetched ${fetched}, skipped ${skipped} already present, failed ${failed}`);
if (failed > 0) process.exitCode = 1;
