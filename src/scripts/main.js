import gsap from 'gsap';
import ScrollTrigger from 'gsap/ScrollTrigger';

import { readEnv } from './lib/env.js';
import { createSmoothScroll } from './lib/smooth-scroll.js';
import { createFrameSequence } from './lib/frame-sequence.js';
import { createChromeHover } from './lib/chrome-hover.js';
import { createKineticText } from './lib/kinetic-text.js';
import { createDemoButton } from './lib/demo-button.js';
import {
  bindSequence,
  bindCaptions,
  bindHud,
  bindProgress,
  bindBottomHud,
  bindLineReveal,
  bindOutro,
  createTelemetry,
} from './lib/scenes.js';

import {
  TOTAL_FRAMES,
  SEQ_EXT,
  SEQ_VERSION,
  CHROME_SEQ_VERSION,
  seqDir,
  chromeSeqDir,
} from './lib/sequence-config.js';

function boot() {
  const env = readEnv();

  const stage = document.querySelector('[data-stage]');
  const canvas = document.querySelector('[data-sequence]');
  const captions = document.querySelector('[data-captions]');
  const manifesto = document.querySelector('[data-manifesto]');
  const kinetic = document.querySelector('[data-kinetic]');
  const progress = document.querySelector('[data-progress]');
  const cue = document.querySelector('[data-cue]');
  const outro = document.querySelector('.outro');

  const lenis = createSmoothScroll(env);

  /* ---- 1. Canvas ------------------------------------------------ */
  const sequence = createFrameSequence({
    canvas,
    total: TOTAL_FRAMES,
    dir: seqDir(env.asset),
    ext: SEQ_EXT,
    version: SEQ_VERSION,
    dpr: env.dpr,
    concurrency: env.concurrency,
    focal: [0.5, 0.5],
    /**
     * Zoom [inicio, fim].
     *
     * 0.92 no início: o crânio inteiro cabe com ar à volta, sem corte.
     *
     * 1.47 no fim, e o valor não é arbitrário: a própria animação
     * AFASTA-SE — o sujeito encolhe de 59.4% para 40.9% da altura da
     * fonte (fator 0.69). Um zoom de 1.15 seria engolido por esse
     * recuo e o resultado líquido continuaria a ser um zoom-out.
     * 1.47 compensa o recuo e ainda sobra: o sujeito cresce de 54.7%
     * para 60.1% da altura do ecrã.
     *
     * Se re-renderizares com outro movimento de câmara, re-afina este
     * segundo valor.
     */
    zoom: [0.92, 1.47],
  });

  /* ---- 2. Hover -------------------------------------------------
     A versão cromada usa exatamente o índice e o transform da base.
     O ticker do hover vem primeiro para a composição acontecer no
     mesmo rAF, sem um frame de atraso. */
  const hover = createChromeHover({
    canvas,
    sequence,
    total: TOTAL_FRAMES,
    dir: chromeSeqDir(env.asset),
    ext: SEQ_EXT,
    version: CHROME_SEQ_VERSION,
    concurrency: Math.max(2, Math.floor(env.concurrency / 2)),
    pixelRatio: env.dpr,
    reducedMotion: env.reducedMotion,
  });

  // Um único relógio (GSAP): estado do hover -> composição da sequência.
  gsap.ticker.add(hover.tick);
  gsap.ticker.add(sequence.tick);

  if (import.meta.env.DEV) {
    Object.assign(window, {
      __env: env,
      __seq: sequence,
      __lenis: lenis,
      __ST: ScrollTrigger,
      __hover: hover,
      __gsap: gsap,
    });
  }

  /* ---- 3. Cenas -------------------------------------------------- */
  const telemetry = createTelemetry(
    document.querySelector('[data-telemetry]'),
    TOTAL_FRAMES
  );

  bindSequence({
    sequence,
    hover,
    captions,
    stage,
    manifesto,
    onProgress: telemetry.setSequence,
  });
  bindCaptions(captions);
  bindHud(manifesto);
  bindProgress(progress, telemetry.setPage);
  bindBottomHud([cue, document.querySelector('[data-byline]')], outro);
  bindLineReveal(captions);
  bindOutro(outro);

  /* Botão magnético que percorre a sequência até ao painel branco. */
  createDemoButton({
    button: document.querySelector('[data-demo]'),
    lenis,
    // A telemetria de "Page" usa exatamente o mesmo maxScroll.
    getTarget: () => ScrollTrigger.maxScroll(window) * 0.8,
  });

  /* ---- 4. Texto cinético ---------------------------------------- */
  createKineticText(kinetic, {
    blur: env.blur,
    reducedMotion: env.reducedMotion,
  });

  /* ---- 5. Gate de carregamento ----------------------------------
     O scroll fica travado até existir um frame a cada ~24 (primeira
     passagem da escada). São poucos ficheiros: abre em <1 s em rede
     decente e garante que nunca se faz scrub sobre o vazio.

     Sem percentagem: o gate espera pela 1.ª passagem (~5 % do total),
     logo qualquer número mostrado estaria a medir a coisa errada. */
  if (!env.reducedMotion) lenis.stop();

  sequence.load().then(() => {
    lenis.start();
    ScrollTrigger.refresh();
  });
  hover.load();

  /* ---- 6. Refresh depois das fontes -----------------------------
     Instrument Serif tem métricas muito diferentes do fallback: sem
     este refresh os `start/end` ficam calculados com o layout errado. */
  document.fonts?.ready.then(() => ScrollTrigger.refresh());

  /* ---- 7. Toggles de UI (só estado visual, como no vídeo) ------- */
  document.querySelector('[data-theme-toggle]')?.addEventListener('click', () => {
    const el = document.documentElement;
    el.setAttribute(
      'data-hud',
      el.getAttribute('data-hud') === 'light' ? 'dark' : 'light'
    );
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
