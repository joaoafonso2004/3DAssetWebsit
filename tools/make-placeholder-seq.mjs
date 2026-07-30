/**
 * make-placeholder-seq.mjs
 * Gera uma sequência sintética com alpha para poderes ver a página a
 * funcionar ANTES de renderizar no Blender.
 *
 *   node tools/make-placeholder-seq.mjs --frames 150
 *
 * Não é o asset final — é uma forma metaball a agitar-se e a esticar,
 * só para validar loader, scrub, pin e enquadramento cover.
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const argv = process.argv.slice(2);
const arg = (k, d) => {
  const i = argv.indexOf(`--${k}`);
  return i > -1 ? Number(argv[i + 1]) : d;
};

const FRAMES = arg('frames', 150);
const TIERS = [
  { name: 'desktop', size: 1440 },
  { name: 'mobile', size: 1080 },
];
const S = 1600; // canvas de autoria

const lerp = (a, b, t) => a + (b - a) * t;

function svg(t) {
  // t = 0..1 ao longo da sequência
  const zoom = lerp(0.52, 1.28, t); // push-in da câmara
  const drip = lerp(0, 250, t * t); // escorrer acelera
  const spin = lerp(-12, 26, t);

  const blobs = Array.from({ length: 6 }, (_, i) => {
    const a = (i / 6) * Math.PI * 2 + t * 2.4;
    const r = 190 * zoom * (0.62 + 0.3 * Math.sin(a * 1.7 + t * 5));
    const cx = S / 2 + Math.cos(a) * 150 * zoom;
    const cy = S / 2 + Math.sin(a * 1.3) * 130 * zoom;
    return `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}"/>`;
  }).join('');

  const strands = Array.from({ length: 9 }, (_, i) => {
    const x = S / 2 + (i - 4) * 78 * zoom;
    const w = 15 + 13 * Math.sin(i * 2.1);
    const h = drip * (0.45 + 0.55 * Math.abs(Math.sin(i * 1.9 + t * 3)));
    return `<rect x="${(x - w / 2).toFixed(1)}" y="${(S / 2).toFixed(0)}"
      width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="${(w / 2).toFixed(1)}"/>`;
  }).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}">
    <defs>
      <filter id="goo">
        <feGaussianBlur stdDeviation="26" result="b"/>
        <feColorMatrix in="b" type="matrix"
          values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 24 -11"/>
      </filter>
      <linearGradient id="chrome" x1="0.15" y1="0" x2="0.85" y2="1">
        <stop offset="0" stop-color="#ffffff"/>
        <stop offset="0.34" stop-color="#e8ecef"/>
        <stop offset="0.52" stop-color="#9aa3ab"/>
        <stop offset="0.68" stop-color="#f4f6f7"/>
        <stop offset="1" stop-color="#b9c0c6"/>
      </linearGradient>
      <mask id="m">
        <g fill="#fff" filter="url(#goo)"
           transform="rotate(${spin.toFixed(2)} ${S / 2} ${S / 2})">
          ${blobs}${strands}
        </g>
      </mask>
    </defs>
    <rect width="${S}" height="${S}" fill="url(#chrome)" mask="url(#m)"/>
  </svg>`;
}

for (const tier of TIERS) {
  const dir = path.join('public', 'seq', tier.name);
  await mkdir(dir, { recursive: true });
  for (let i = 0; i < FRAMES; i += 1) {
    const buf = Buffer.from(svg(i / (FRAMES - 1)));
    await sharp(buf)
      .resize(tier.size, tier.size)
      .webp({ quality: 78, alphaQuality: 90, effort: 4 })
      .toFile(path.join(dir, `frame_${String(i + 1).padStart(4, '0')}.webp`));
  }
  console.log(`${tier.name}: ${FRAMES} frames @ ${tier.size}px`);
}
console.log('Placeholder pronto. npm run dev');
