/**
 * frame-sequence.js
 * Motor de scrubbing de sequência de imagens em Canvas 2D.
 *
 * Decisões que dão a fluidez:
 *
 *  1. Carregamento em ESCADA (strides 24 → 8 → 4 → 2 → 1). Depois da
 *     primeira passagem já existe um frame a cada ~24, logo qualquer
 *     posição de scroll tem algo para desenhar. Nunca há canvas vazio,
 *     e a nitidez aumenta enquanto o utilizador lê o hero.
 *
 *  2. `createImageBitmap` em vez de <img>: a descodificação acontece
 *     fora da main thread e o `drawImage` fica ~O(blit). É a diferença
 *     entre 60 fps e stutter a cada frame novo.
 *
 *  3. Um único ponto de desenho, chamado pelo ticker do GSAP, e só
 *     quando algo mudou. O ScrollTrigger escreve um número; o desenho
 *     acontece uma vez por rAF, nunca por evento de scroll.
 *
 *  4. Desenho DIRETO no canvas visível, mais uma máscara minúscula
 *     (128 px de largura) para o teste de silhueta. O hover precisa de
 *     saber se o cursor está sobre o objeto ou sobre o vazio; ler o
 *     alpha do canvas grande a cada movimento do rato seria um readback
 *     de mais de um milhão de pixels, e aqui são ~5 mil, uma vez por
 *     frame.
 */

const pad = (n, w = 4) => String(n).padStart(w, '0');

/** Ordem de carregamento: passagens de granularidade crescente. */
function ladder(total, strides = [24, 8, 4, 2, 1]) {
  const seen = new Uint8Array(total);
  const passes = [];
  for (const s of strides) {
    const pass = [];
    for (let i = 0; i < total; i += s) {
      if (!seen[i]) {
        seen[i] = 1;
        pass.push(i);
      }
    }
    if (passes.length === 0 && !seen[total - 1]) {
      seen[total - 1] = 1;
      pass.push(total - 1);
    }
    if (pass.length) passes.push(pass);
  }
  return passes;
}

export function createFrameSequence({
  canvas,
  total,
  dir,
  ext = 'webp',
  /**
   * Token de versão da sequência. Muda-o sempre que re-renderizares no
   * Blender: sem isto, quem já visitou o site continua a ver os frames
   * antigos indefinidamente.
   */
  version: assetVersion = '',
  /** Ponto focal do enquadramento: [x, y] em 0..1. */
  focal = [0.5, 0.5],
  /**
   * Zoom [inicio, fim], interpolado com o progresso do scroll.
   *
   * A base é `contain`, nunca `cover`. Com `cover`, uma fonte quadrada
   * num ecrã 2:1 mostra só 50% da sua altura — e o sujeito fica
   * decapitado. Com `contain`, zoom 1.0 significa "a fonte inteira
   * cabe"; abaixo de 1 sobra ar, acima de 1 corta a partir daí.
   *
   * O eixo apertado é escolhido em runtime: altura em landscape,
   * largura em portrait. O canvas é transparente, portanto o espaço
   * que sobra mostra o gradiente do palco, não barras pretas.
   */
  zoom = [0.92, 1.15],
  concurrency = 8,
  dpr = 1,
  onProgress,
}) {
  const ctx = canvas.getContext('2d', { alpha: true, desynchronized: true });

  const frames = new Array(total).fill(null);
  let loaded = 0;
  let index = 0; // índice pedido pelo scroll
  let painted = -1; // índice desenhado
  let progress = 0; // 0..1 do scroll, usado pelo zoom
  let drawnProgress = -1; // progresso com que o canvas foi composto
  let cw = 0;
  let ch = 0;
  let running = true;
  let overlay = null; // passagem opcional depois de cada pintura
  let forcePaint = false;
  let maskFrame = null;
  let maskDx = NaN;
  let maskDy = NaN;
  let maskDw = NaN;
  let maskDh = NaN;

  /* --- Máscara de silhueta -----------------------------------------
     Cópia minúscula do frame só para responder a "o cursor está por
     cima do objeto ou do vazio?". Ler o alpha do canvas grande por
     evento de rato seria um readback de 1.4M pixels; aqui são ~5k, uma
     vez por frame, e a resposta é igualmente exata ao nível do pixel
     que interessa. */
  const MASK_W = 256;
  const mask = document.createElement('canvas');
  const mctx = mask.getContext('2d', { alpha: true, willReadFrequently: true });
  let maskData = null;
  let maskH = 0;

  const suffix = assetVersion ? `?v=${assetVersion}` : '';
  const url = (i) => `${dir}/frame_${pad(i + 1)}.${ext}${suffix}`;

  /* ---------------------------------------------------------------
     Carregamento
     --------------------------------------------------------------- */
  async function fetchFrame(i) {
    if (frames[i]) return;
    try {
      // Cache por omissão, respeitando os headers HTTP. NUNCA
      // `force-cache`: isso manda o browser usar a resposta guardada
      // sem validar, e um re-render da sequência fica invisível para
      // quem já visitou o site — foi exatamente o que aconteceu ao
      // trocar o placeholder pela mão (frame 1 vinha do <link preload>,
      // já revalidado; os outros 149 vinham da cache velha).
      const res = await fetch(url(i));
      if (!res.ok) throw new Error(res.status);
      const blob = await res.blob();
      frames[i] =
        typeof createImageBitmap === 'function'
          ? await createImageBitmap(blob)
          : await blobToImage(blob);
      loaded += 1;
      onProgress?.(loaded / total);
      if (i === index) painted = -1; // chegou o frame pedido: repinta
    } catch {
      /* Um frame em falta é resolvido pelo vizinho: não bloqueia. */
    }
  }

  function blobToImage(blob) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = URL.createObjectURL(blob);
    });
  }

  async function runPass(list) {
    let cursor = 0;
    const worker = async () => {
      while (cursor < list.length) await fetchFrame(list[cursor++]);
    };
    await Promise.all(
      Array.from({ length: Math.min(concurrency, list.length) }, worker)
    );
  }

  /**
   * Arranca o carregamento. Resolve assim que a 1.ª passagem termina —
   * é esse o momento em que é seguro libertar o scroll.
   */
  function load() {
    const passes = ladder(total);
    const first = runPass(passes[0]);
    first.then(async () => {
      for (let p = 1; p < passes.length; p += 1) await runPass(passes[p]);
    });
    return first;
  }

  /* ---------------------------------------------------------------
     Desenho
     --------------------------------------------------------------- */

  /** Frame carregado mais próximo de `i` (procura para fora). */
  function nearest(i) {
    if (frames[i]) return frames[i];
    for (let d = 1; d < total; d += 1) {
      if (i - d >= 0 && frames[i - d]) return frames[i - d];
      if (i + d < total && frames[i + d]) return frames[i + d];
    }
    return null;
  }

  function resize() {
    const r = canvas.getBoundingClientRect();
    const w = Math.round(r.width * dpr);
    const h = Math.round(r.height * dpr);
    // Um rect de 0 acontece se o módulo arrancar antes de o layout
    // assentar (iframes, panes escondidos, restauro de sessão). Escrever
    // 0 no canvas mata-o em silêncio: o tick abaixo volta a tentar.
    if (w === 0 || h === 0) return;
    if (cw === w && ch === h) return;
    cw = w;
    ch = h;
    canvas.width = cw;
    canvas.height = ch;
    painted = -1; // o buffer foi limpo pelo resize
  }

  /** Pinta o frame, escalado pelo eixo apertado + zoom. */
  function paint(frame) {
    const iw = frame.width;
    const ih = frame.height;
    const z = zoom[0] + (zoom[1] - zoom[0]) * progress;
    // `min` = contain: a fonte inteira cabe, e o zoom corta a partir daí.
    // Tem de ser o EIXO APERTADO, escolhido em runtime — em landscape é
    // a altura, em portrait é a largura. Escalar sempre pela altura
    // funciona no desktop e decapita o sujeito lateralmente no telefone.
    const s = Math.min(cw / iw, ch / ih) * z;
    const dw = iw * s;
    const dh = ih * s;
    const dx = (cw - dw) * focal[0];
    const dy = (ch - dh) * focal[1];

    ctx.clearRect(0, 0, cw, ch);
    ctx.drawImage(frame, dx, dy, dw, dh);
    drawnProgress = progress;

    // Máscara de silhueta — construída SÓ se alguém a for usar. Sem
    // consumidor registado seria um getImageData por frame a alimentar
    // ninguém.
    if (
      overlay &&
      (maskFrame !== frame ||
        maskDx !== dx ||
        maskDy !== dy ||
        maskDw !== dw ||
        maskDh !== dh)
    ) {
      maskH = Math.max(1, Math.round((MASK_W * ch) / cw));
      if (mask.width !== MASK_W || mask.height !== maskH) {
        mask.width = MASK_W;
        mask.height = maskH;
      }
      const k = MASK_W / cw;
      mctx.clearRect(0, 0, MASK_W, maskH);
      mctx.drawImage(frame, dx * k, dy * k, dw * k, dh * k);
      maskData = mctx.getImageData(0, 0, MASK_W, maskH).data;
      maskFrame = frame;
      maskDx = dx;
      maskDy = dy;
      maskDw = dw;
      maskDh = dh;
    }

    // Argumentos posicionais evitam criar um objeto novo a cada rAF.
    overlay?.(ctx, frame, index, dx, dy, dw, dh, cw, ch);
  }

  /** Chamado uma vez por rAF pelo ticker do GSAP. */
  function tick() {
    if (!running) return;
    // Auto-cura: comparação de inteiros, custo nulo no caso normal.
    if (cw === 0) resize();
    if (cw === 0) return;

    // O zoom varia continuamente com o scroll, o índice só muda a cada
    // ~15 px. Sem o segundo teste, o zoom ficaria aos degraus.
    if (
      painted !== index ||
      forcePaint ||
      Math.abs(progress - drawnProgress) > 0.0008
    ) {
      const frame = nearest(index);
      if (frame) {
        paint(frame);
        painted = index;
        forcePaint = false;
      }
    }
  }

  /* ---------------------------------------------------------------
     API
     --------------------------------------------------------------- */
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  resize();

  return {
    load,
    tick,
    /** progress 0..1 vindo do ScrollTrigger. */
    setProgress(p) {
      progress = p < 0 ? 0 : p > 1 ? 1 : p;
      const next = Math.round(progress * (total - 1));
      index = next < 0 ? 0 : next > total - 1 ? total - 1 : next;
    },
    /** Para o desenho quando o palco está totalmente coberto. */
    setActive(on) {
      running = on;
      if (on) painted = -1;
    },
    /** Passagem desenhada logo a seguir a cada pintura do frame. */
    setOverlay(fn) {
      overlay = fn;
      maskFrame = null;
      painted = -1;
    },
    /** Obriga a repintar no próximo tick (o overlay mudou, o frame não). */
    requestPaint() {
      forcePaint = true;
    },
    /**
     * O ponto (px de dispositivo) cai sobre o objeto ou sobre o vazio?
     * É isto que permite ao hover reagir só em cima da caveira.
     */
    isOpaqueAt(x, y) {
      if (!maskData || cw === 0) return false;
      const mx = Math.floor((x / cw) * MASK_W);
      const my = Math.floor((y / ch) * maskH);
      if (mx < 0 || my < 0 || mx >= MASK_W || my >= maskH) return false;
      return maskData[(my * MASK_W + mx) * 4 + 3] > 24;
    },
    get progressLoaded() {
      return loaded / total;
    },
    destroy() {
      ro.disconnect();
      frames.forEach((f) => f?.close?.());
    },
  };
}
