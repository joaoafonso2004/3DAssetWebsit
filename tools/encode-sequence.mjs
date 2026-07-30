/**
 * encode-sequence.mjs
 * PNG RGBA do Blender -> dois tiers WebP com alpha para o browser.
 *
 *   node tools/encode-sequence.mjs --in ./raw-seq --out ./public/seq
 *
 * Porque WebP e nao PNG: alpha lossy. Um frame destes passa de ~1.4 MB
 * (PNG) para ~70 KB (WebP q78) sem diferenca visivel em movimento — e
 * 150 frames a 1.4 MB sao 210 MB, o que nao e um site.
 *
 * Porque dois tiers: um telefone nunca precisa de 1600 px. O env.js
 * escolhe a pasta pela aresta longa real do ecra.
 */
import { mkdir, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const argv = process.argv.slice(2);
const arg = (k, d) => {
  const i = argv.indexOf(`--${k}`);
  return i > -1 ? argv[i + 1] : d;
};

const IN = path.resolve(arg('in', './raw-seq'));
const OUT = path.resolve(arg('out', './public/seq'));
const QUALITY = Number(arg('quality', 78));

/**
 * Tamanhos: um asset quadrado em portrait é escalado por
 * altura_do_canvas / lado. Com o cap de dpr 1.5 do env.js, um telefone
 * de 880 CSS px de altura pede ~1320 px — daí 1080 no tier mobile
 * (ampliação de 1.22x, invisível num render em movimento) e não 900.
 */
const TIERS = [
  { name: 'desktop', size: 1440 },
  { name: 'mobile', size: 1080 },
];

const CONCURRENCY = Math.max(2, (await import('node:os')).cpus().length - 1);

async function pool(items, worker) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
      while (i < items.length) await worker(items[i++]);
    })
  );
}

const files = (await readdir(IN))
  .filter((f) => /\.(png|exr|tif?f)$/i.test(f))
  .sort();

if (!files.length) {
  console.error(`Nenhum frame em ${IN}. Corre primeiro: npm run seq:render`);
  process.exit(1);
}

console.log(`${files.length} frames · ${CONCURRENCY} workers`);

for (const tier of TIERS) {
  const dir = path.join(OUT, tier.name);
  await mkdir(dir, { recursive: true });

  let bytes = 0;
  await pool(files, async (file) => {
    // Renumera de 1: o loader espera frame_0001 contiguo, mesmo que o
    // Blender tenha saltado frames (--step) ou comecado noutro numero.
    const n = files.indexOf(file) + 1;
    const dest = path.join(dir, `frame_${String(n).padStart(4, '0')}.webp`);

    await sharp(path.join(IN, file))
      .resize(tier.size, tier.size, {
        fit: 'inside',
        withoutEnlargement: true,
        // Sem premultiply: com alpha, premultiplicar suja as bordas.
        kernel: 'lanczos3',
      })
      .webp({ quality: QUALITY, alphaQuality: 90, effort: 5, smartSubsample: true })
      .toFile(dest);

    bytes += (await stat(dest)).size;
  });

  const mb = bytes / 1024 / 1024;
  console.log(
    `  ${tier.name.padEnd(8)} ${tier.size}px  ` +
      `${mb.toFixed(1)} MB total · ${(bytes / files.length / 1024).toFixed(0)} KB/frame`
  );
}

console.log(`\nPronto -> ${OUT}`);
console.log('Confirma que TOTAL_FRAMES em src/scripts/main.js = ' + files.length);
