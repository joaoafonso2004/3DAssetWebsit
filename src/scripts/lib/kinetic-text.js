import gsap from 'gsap';
import ScrollTrigger from 'gsap/ScrollTrigger';

/**
 * kinetic-text.js — revelação cinética palavra a palavra.
 *
 * O que se observa no vídeo, medido nos frames 4.80 s / 5.40 s / 6.30 s:
 *
 *  · cada PALAVRA (não letra) tem posição, rotação e escala próprias;
 *  · o espalhamento inicial cobre toda a largura do painel e uma banda
 *    vertical de cerca de ±0.6× a altura do parágrafo;
 *  · há blur forte no início que desaparece ao assentar;
 *  · as palavras não aparecem todas ao mesmo tempo — a 4.80 s só ~6
 *    estão visíveis, logo há stagger em ordem aleatória;
 *  · a convergência é 100 % ligada ao scroll (scrub), não temporizada.
 *
 * O ruído é SEMEADO: o mesmo parágrafo dá sempre o mesmo caos. Isso
 * torna o efeito afinável (e não "diferente" a cada reload).
 */

/** mulberry32 — PRNG determinístico de 32 bits. */
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SCATTER = {
  x: 0.34, // fração da largura do bloco
  y: 0.62, // fração da altura do bloco
  rotate: 26, // graus, ±
  scaleMin: 0.72,
  scaleMax: 1.34,
  blur: 15, // px
};

/**
 * Parte o texto em <span class="kinetic__word">.
 * Mantém os espaços como nós de texto (o parágrafo continua a fluir
 * e a quebrar linha sozinho — as posições finais são as do layout).
 */
function splitWords(el) {
  const source = el.textContent.trim().replace(/\s+/g, ' ');
  el.textContent = '';

  const visual = document.createElement('span');
  visual.setAttribute('aria-hidden', 'true');

  const words = [];
  source.split(' ').forEach((w, i) => {
    if (i > 0) visual.append(document.createTextNode(' '));
    const span = document.createElement('span');
    span.className = 'kinetic__word';
    span.textContent = w;
    visual.append(span);
    words.push(span);
  });

  // Cópia acessível: leitores de ecrã leem uma frase, não 44 fragmentos.
  const sr = document.createElement('span');
  sr.className = 'sr';
  sr.textContent = source;

  el.append(visual, sr);
  return words;
}

export function createKineticText(el, { blur = true, reducedMotion = false } = {}) {
  const words = splitWords(el);
  el.dataset.blur = blur ? 'on' : 'off';
  el.dataset.armed = 'true';

  if (reducedMotion) {
    gsap.set(words, { opacity: 1 });
    return null;
  }

  // Um "grão" fixo por palavra. Calculado uma vez; as posições são
  // derivadas dele em runtime, para que um resize recalcule o caos com
  // a nova medida sem o tornar diferente.
  const rand = seeded(words.length * 2654435761);
  const grain = words.map(() => ({
    x: rand() * 2 - 1,
    y: rand() * 2 - 1,
    r: rand() * 2 - 1,
    s: rand(),
  }));

  const box = () => el.getBoundingClientRect();

  /**
   * Estado inicial aplicado por `set`, não por `fromTo`.
   *
   * Porquê: um `fromTo` com `invalidateOnRefresh` perde o estado inicial
   * quando o ScrollTrigger invalida o tween antes de o trigger ter sido
   * alcançado — as palavras aparecem já montadas ao carregar a página.
   * Com `set` + `to` (que grava os valores de partida no primeiro
   * render) o caos é reaplicado a cada refresh e o `to` volta a ler a
   * medida nova. É o padrão do GSAP para `from` states responsivos.
   */
  const scatter = () => {
    const b = box();
    words.forEach((w, i) => {
      gsap.set(w, {
        x: grain[i].x * b.width * SCATTER.x,
        y: grain[i].y * b.height * SCATTER.y,
        rotate: grain[i].r * SCATTER.rotate,
        scale:
          SCATTER.scaleMin + grain[i].s * (SCATTER.scaleMax - SCATTER.scaleMin),
        opacity: 0,
        force3D: true,
        ...(blur ? { filter: `blur(${SCATTER.blur}px)` } : {}),
      });
    });
  };

  scatter();
  ScrollTrigger.addEventListener('refreshInit', scatter);

  const tl = gsap.timeline({
    scrollTrigger: {
      trigger: el.closest('[data-manifesto]') ?? el,
      // Começa antes do painel assentar: no vídeo já há palavras
      // espalhadas enquanto o painel branco ainda sobe.
      start: 'top 78%',
      end: '+=130%',
      scrub: true, // sem número: a suavização é a do Lenis, não a dupla
      invalidateOnRefresh: true,
      onEnter: () => gsap.set(words, { willChange: 'transform, opacity' }),
      onLeave: () => gsap.set(words, { willChange: 'auto' }),
      onLeaveBack: () => gsap.set(words, { willChange: 'auto' }),
    },
  });

  tl.to(words, {
    x: 0,
    y: 0,
    rotate: 0,
    scale: 1,
    opacity: 1,
    ...(blur ? { filter: 'blur(0px)' } : {}),
    force3D: true,
    ease: 'none', // o easing é o do scroll; aqui tem de ser linear
    stagger: { each: 0.018, from: 'random' },
  });

  return tl;
}
