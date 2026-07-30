import gsap from 'gsap';

/**
 * demo-button.js — o único controlo do chrome, e faz alguma coisa.
 *
 * Dois comportamentos:
 *
 *  1. MAGNÉTICO. O botão é atraído pelo cursor dentro de um raio, com
 *     a etiqueta a deslocar-se mais que a cápsula. É a demonstração
 *     mais barata de "isto responde a ti".
 *
 *  2. PLAY. Ao clicar, percorre a sequência inteira sozinho, com o
 *     easing do Lenis. Mostra a coreografia toda sem o utilizador ter
 *     de a descobrir — e é reversível: clicar outra vez volta ao topo.
 *
 * O `translate: -50%` de centragem é feito aqui e não em CSS: misturar
 * a propriedade `translate` do CSS com o `transform` do GSAP faz os
 * dois disputarem o mesmo valor computado e o botão salta.
 */

const RADIUS = 130; // px de atração
const PULL = 0.32; // fração da distância que a cápsula percorre
const LABEL_PULL = 0.5; // a etiqueta puxa mais: dá profundidade

export function createDemoButton({ button, lenis, getTarget }) {
  if (!button) return null;

  const label = button.querySelector('[data-demo-label]');
  const original = label?.textContent ?? '';
  let playing = false;
  let tween = null;

  // Centragem + magnetismo no mesmo transform.
  gsap.set(button, { xPercent: -50 });

  const fine = window.matchMedia('(pointer: fine)').matches;

  function onMove(e) {
    if (!fine) return;
    const r = button.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const dx = e.clientX - cx;
    const dy = e.clientY - cy;
    const dist = Math.hypot(dx, dy);

    if (dist > RADIUS) {
      gsap.to(button, { x: 0, y: 0, duration: 0.6, ease: 'elastic.out(1, 0.5)' });
      gsap.to(label, { x: 0, y: 0, duration: 0.6, ease: 'elastic.out(1, 0.5)' });
      return;
    }
    // Quanto mais perto, mais forte: falloff linear.
    const f = 1 - dist / RADIUS;
    gsap.to(button, {
      x: dx * PULL * f,
      y: dy * PULL * f,
      duration: 0.35,
      ease: 'power3.out',
    });
    gsap.to(label, {
      x: dx * (LABEL_PULL - PULL) * f,
      y: dy * (LABEL_PULL - PULL) * f,
      duration: 0.45,
      ease: 'power3.out',
    });
  }

  function stop() {
    playing = false;
    tween?.kill();
    tween = null;
    button.removeAttribute('data-playing');
    if (label) label.textContent = original;
  }

  function play() {
    const to = getTarget();
    const from = lenis.scroll;
    const distance = Math.abs(to - from);
    if (distance < 8) return;

    playing = true;
    button.setAttribute('data-playing', '');
    if (label) label.textContent = 'Stop';

    // Duração proporcional à distância: a mesma sensação de velocidade
    // independentemente de onde o utilizador está na página.
    const duration = Math.min(9, Math.max(3.2, distance / 420));
    lenis.scrollTo(to, {
      duration,
      easing: (t) => 1 - Math.pow(1 - t, 3),
      onComplete: stop,
    });
    // Se o utilizador tocar na roda, o Lenis cancela sozinho; este
    // temporizador garante que o estado visual não fica preso.
    tween = gsap.delayedCall(duration + 0.2, stop);
  }

  button.addEventListener('click', () => (playing ? (lenis.scrollTo(lenis.scroll, { immediate: true }), stop()) : play()));
  window.addEventListener('pointermove', onMove, { passive: true });

  return {
    destroy() {
      window.removeEventListener('pointermove', onMove);
      stop();
    },
  };
}
