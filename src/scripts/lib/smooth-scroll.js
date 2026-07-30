import Lenis from 'lenis';
import gsap from 'gsap';
import ScrollTrigger from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

/**
 * INÉRCIA — como o valor foi obtido
 * -----------------------------------------------------------------
 * No vídeo de referência segui a aresta superior do painel claro
 * frame a frame (30 Hz de origem) e obtive a velocidade em px/frame:
 *
 *   12 → 10 → 9 → 8 → 7 → 7        (janela de desaceleração limpa)
 *
 * Decaimento de 7/12 = 0.583 em 5 frames a 30 Hz, ou seja 10 frames
 * de rAF a 60 Hz:  (1 - lerp)^10 = 0.583  →  lerp ≈ 0.053.
 * Uma segunda janela (a cauda final, 5.73 s → 6.17 s) devolveu 0.052.
 *
 * Logo: lerp = 0.055. Mais "flutuante" que o default do Lenis
 * (duration 1.2 ≈ lerp 0.09) — é isso que dá o peso do vídeo.
 * Sobe para 0.075 se quiseres a página mais reativa.
 */
export const LERP = 0.055;

export function createSmoothScroll({ reducedMotion }) {
  const lenis = new Lenis({
    lerp: LERP,
    // Sem `duration`: o modelo lerp é o que corresponde à medição.
    wheelMultiplier: 0.9,
    touchMultiplier: 1.5,
    // Toque nativo: o browser já tem momentum próprio, duplicar arrasta.
    syncTouch: false,
    smoothWheel: !reducedMotion,
    autoRaf: false, // o ticker do GSAP é a única fonte de tempo
    anchors: { offset: 0 },
  });

  if (reducedMotion) lenis.stop();

  // --- A ligação canónica Lenis <-> ScrollTrigger ------------------
  // 1. Lenis emite scroll -> ScrollTrigger recalcula no mesmo tick.
  lenis.on('scroll', ScrollTrigger.update);
  // 2. Um único rAF para tudo (evita dois loops a competir).
  gsap.ticker.add((time) => lenis.raf(time * 1000));
  // 3. Sem lag smoothing: com scrub, "recuperar" tempo perdido faz salto.
  gsap.ticker.lagSmoothing(0);

  // Resize em mobile = barra de endereço a aparecer/desaparecer.
  // Sem isto o ScrollTrigger faz refresh e a página salta.
  ScrollTrigger.config({ ignoreMobileResize: true });

  /* --- Medição obsoleta: a falha mais cara desta página ------------
     O ScrollTrigger só refresca no evento `resize` da window. Se o
     viewport mudar sem esse evento — iframe, painel de preview, tab
     restaurada, ou um boot com o layout ainda a 0 — TODOS os triggers
     ficam medidos contra um documento errado.

     E não falha de forma visível: falha em cascata. Aconteceu aqui o
     documento ser medido a 914 px em vez de 3143, o trigger do
     manifesto disparar `onEnter` de imediato, e o palco ficar com
     `visibility: hidden` para o resto da sessão — canvas morto, sem
     um único erro na consola.

     Um ResizeObserver no elemento raiz apanha todos esses casos. */
  let lastW = 0;
  let lastH = 0;
  let pending = 0;
  const viewport = new ResizeObserver(() => {
    const w = document.documentElement.clientWidth;
    const h = document.documentElement.clientHeight;
    if (w === lastW && h === lastH) return;
    lastW = w;
    lastH = h;
    // Debounce: um refresh é caro e o observer dispara em rajada
    // durante um arrasto de redimensionamento.
    clearTimeout(pending);
    pending = setTimeout(() => ScrollTrigger.refresh(), 150);
  });
  viewport.observe(document.documentElement);

  // Nenhum scrollerProxy: o Lenis em modo default escreve a posição de
  // scroll nativa da window, logo o ScrollTrigger já a lê corretamente.
  return lenis;
}
