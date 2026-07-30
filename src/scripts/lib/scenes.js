import gsap from 'gsap';
import ScrollTrigger from 'gsap/ScrollTrigger';

/**
 * scenes.js — todo o comportamento ligado ao scroll, exceto o texto
 * cinético. Cada função é independente e devolve o que criou.
 *
 * Regra transversal: `scrub: true` sem número. O Lenis já é a única
 * camada de suavização; um scrub numérico por cima adiciona um segundo
 * lag e é exatamente o que faz um site destes parecer "molhado".
 */

/* ------------------------------------------------------------------
   1. Sequência: progress do scroll -> índice de frame
   ------------------------------------------------------------------ */
export function bindSequence({
  sequence,
  hover,
  captions,
  stage,
  manifesto,
  onProgress,
}) {
  // O intervalo de scrubbing é exatamente a corrida das legendas:
  // começa quando o palco cola ao topo, acaba quando a última legenda
  // sai. Sem números mágicos — muda o número de legendas e ajusta-se.
  const scrub = ScrollTrigger.create({
    trigger: captions,
    start: 'top top',
    /**
     * O último frame tem de cair EXATAMENTE quando o painel acaba de
     * tapar o crânio. Nem antes (vê-se congelado), nem depois (gastam-se
     * frames escondidos).
     *
     * O painel sobe de baixo, portanto o topo do crânio é a última
     * parte a ser coberta. O crânio ocupa 17%–77% da altura do ecrã no
     * fim da sequência, logo o instante certo é aquele em que o bordo
     * superior do painel passa os 17%:
     *
     *     scroll = topoDoPainel − 0.17 × altura do ecrã
     *
     * A versão anterior usava `+12%`, ancorada ao painel encostar ao
     * TOPO DO ECRÃ — mas isso é 29% de ecrã tarde demais, e era por
     * isso que o crânio desaparecia por volta do frame 135.
     *
     * Os 0.15 em vez de 0.17 deixam ~2% de ecrã de folga: mais vale o
     * frame 150 chegar um instante depois de tapado do que um instante
     * antes, que traria de volta o crânio parado.
     */
    end: () =>
      manifesto.getBoundingClientRect().top +
      window.scrollY -
      window.innerHeight * 0.15,
    invalidateOnRefresh: true,
    onUpdate: (self) => {
      sequence.setProgress(self.progress);
      onProgress?.(self.progress);
    },
  });

  // Quando o painel claro cobre o palco por completo, deixa de haver
  // razão para desenhar. Poupa o blit inteiro no resto da página.
  ScrollTrigger.create({
    trigger: manifesto,
    start: 'top top',
    onEnter: () => {
      hover?.setActive(false);
      sequence.setActive(false);
      // Devolver ao repouso antes de esconder: senão o reflexo fica
      // congelado e reaparece aceso ao voltar para cima.
      hover?.rest();
      stage.style.visibility = 'hidden';
    },
    onLeaveBack: () => {
      stage.style.visibility = 'visible';
      sequence.setActive(true);
      hover?.setActive(true);
    },
  });

  return scrub;
}

/* ------------------------------------------------------------------
   2. Legendas: entram a 1:1 com o documento, desvanecem ao sair
   ------------------------------------------------------------------ */
export function bindCaptions(root) {
  const inners = root.querySelectorAll('[data-caption-inner]');
  return Array.from(inners).map((inner) =>
    gsap.to(inner, {
      opacity: 0,
      ease: 'none',
      scrollTrigger: {
        trigger: inner,
        // No vídeo o texto entra a opacidade cheia e só apaga no topo:
        // não há fade-in, apenas fade-out.
        start: 'top 20%',
        end: 'top -2%',
        scrub: true,
      },
    })
  );
}

/* ------------------------------------------------------------------
   3. HUD: inverte de claro/escuro quando o painel toma o topo
   ------------------------------------------------------------------ */
export function bindHud(manifesto) {
  const set = (mode) => document.documentElement.setAttribute('data-hud', mode);
  return ScrollTrigger.create({
    trigger: manifesto,
    // Um pouco antes de o painel encostar ao topo: a inversão tem de
    // acontecer enquanto ainda há contraste para ler o HUD.
    start: 'top 22%',
    onEnter: () => set('light'),
    onLeaveBack: () => set('dark'),
  });
}

/* ------------------------------------------------------------------
   4. Barra de progresso do bordo direito
   ------------------------------------------------------------------ */
export function bindProgress(fill, onPage) {
  return ScrollTrigger.create({
    start: 0,
    end: 'max',
    onUpdate: (self) => {
      fill?.style.setProperty('--p', self.progress.toFixed(4));
      onPage?.(self.progress);
    },
  });
}

/* ------------------------------------------------------------------
   5. HUD de rodapé: some ao chegar ao fim
   Tudo o que está fixo nos cantos de baixo — a seta e a assinatura —
   sobrepõe-se ao conteúdo do rodapé se ficar. Apaga em conjunto.
   ------------------------------------------------------------------ */
export function bindBottomHud(nodes, outro) {
  const targets = nodes.filter(Boolean);
  if (!targets.length || !outro) return null;

  /**
   * Trigger SEMPRE ATIVO (0 → max), com o fade calculado à mão.
   *
   * Duas armadilhas evitadas aqui:
   *  · um tween com `scrub` interpola através do ticker — mais uma peça
   *    a poder dessincronizar-se, quando o que se quer é seguir o
   *    scroll exatamente;
   *  · um trigger delimitado (`trigger: outro`) só corre `onUpdate`
   *    enquanto está ativo: passado o `end`, para de disparar e o
   *    último valor escrito fica preso no ecrã.
   */
  const fade = () => {
    const top = outro.getBoundingClientRect().top;
    const h = window.innerHeight;
    // 1 quando o rodapé ainda vem longe, 0 quando já subiu a 78%.
    const raw = (top - h * 0.78) / (h * 0.22);
    const outroFade = raw < 0 ? 0 : raw > 1 ? 1 : raw;
    // Garantia explícita no fim: mesmo num rodapé muito baixo, a
    // assinatura e a seta chegam a opacity 0 no scroll máximo.
    const remaining = ScrollTrigger.maxScroll(window) - window.scrollY;
    const bottomFade = Math.max(0, Math.min(1, remaining / (h * 0.18)));
    const p = Math.min(outroFade, bottomFade);
    for (const el of targets) {
      el.style.opacity = p.toFixed(3);
      el.style.transform = `translateY(${((1 - p) * 12).toFixed(1)}px)`;
    }
  };

  const st = ScrollTrigger.create({ start: 0, end: 'max', onUpdate: fade });
  fade();
  return st;
}

/* ------------------------------------------------------------------
   8. Telemetria: frame, progresso da sequência e da página
   ------------------------------------------------------------------ */
export function createTelemetry(root, total) {
  if (!root) return { setSequence() {}, setPage() {} };

  const fFrame = root.querySelector('[data-tel-frame]');
  const fSeq = root.querySelector('[data-tel-seq]');
  const fPage = root.querySelector('[data-tel-page]');
  const pad = (n) => String(n).padStart(3, '0');

  let lastFrame = -1;
  let lastSeq = -1;
  let lastPage = -1;

  // O primeiro nó de texto: escrever aqui preserva o <span> do sufixo.
  const write = (el, value) => {
    if (el?.firstChild) el.firstChild.nodeValue = value;
  };

  return {
    setSequence(p) {
      const frame = Math.min(total, Math.round(p * (total - 1)) + 1);
      const pct = Math.round(p * 100);
      // Só escreve quando o valor MUDA: um write por frame de scroll a
      // 60 Hz obrigaria o browser a refazer o layout do texto sem
      // necessidade nenhuma.
      if (frame !== lastFrame) {
        lastFrame = frame;
        write(fFrame, pad(frame));
      }
      if (pct !== lastSeq) {
        lastSeq = pct;
        write(fSeq, String(pct));
      }
    },
    setPage(p) {
      const pct = Math.round(p * 100);
      if (pct === lastPage) return;
      lastPage = pct;
      write(fPage, String(pct));
    },
  };
}

/* ------------------------------------------------------------------
   6. Revelação das legendas: cada linha sobe por trás de uma máscara
   ------------------------------------------------------------------ */
export function bindLineReveal(root) {
  const blocks = root.querySelectorAll('[data-caption-inner]');
  return Array.from(blocks).map((block) => {
    const parts = block.querySelectorAll('.mask > *');
    gsap.set(parts, { yPercent: 110, opacity: 0 });
    return gsap.to(parts, {
      yPercent: 0,
      opacity: 1,
      duration: 1.05,
      ease: 'expo.out',
      stagger: 0.075,
      scrollTrigger: {
        trigger: block,
        // Dispara uma vez, ao entrar: um reveal com scrub voltaria a
        // desmontar-se ao subir, o que num heading grande é irritante.
        start: 'top 88%',
        once: true,
      },
    });
  });
}

/* ------------------------------------------------------------------
   7. Rodapé: as colunas entram desencontradas
   ------------------------------------------------------------------ */
export function bindOutro(outro) {
  if (!outro) return null;
  const items = outro.querySelectorAll('.outro__row > *, .outro__rule');
  return gsap.from(items, {
    y: 26,
    opacity: 0,
    duration: 0.9,
    ease: 'expo.out',
    stagger: 0.08,
    scrollTrigger: { trigger: outro, start: 'top 85%', once: true },
  });
}
