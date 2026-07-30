/**
 * env.js — deteção de capacidade.
 * Uma só passagem, sem listeners: o resultado decide qual tier da
 * sequência carregar e quais efeitos correm.
 *
 * Regra que orienta este ficheiro: NUNCA misturar sinais de rede com
 * sinais de render. Rede decide quanto peso se descarrega; CPU/GPU
 * decide quais efeitos correm. Conflacioná-los faz uma máquina potente
 * numa ligação lenta perder o blur, o que é absurdo.
 */

const mq = (q) => window.matchMedia(q).matches;

export function readEnv() {
  const reducedMotion = mq('(prefers-reduced-motion: reduce)');

  /* --- Largura CSS ------------------------------------------------
     `innerWidth` pode ser 0 em iframes escondidos, tabs restauradas e
     páginas pré-renderizadas. Se o boot apanhar esse momento, o tier
     fica errado para sempre — daí a cadeia de fallbacks. */
  const width =
    window.innerWidth ||
    document.documentElement.clientWidth ||
    window.screen?.width ||
    1280;
  const narrow = width <= 700;

  /**
   * Cap de dpr.
   *
   * Em portrait, um asset QUADRADO tem de cobrir um canvas muito mais
   * alto que largo: a escala de `cover` é altura/lado. Num telefone de
   * 400x880 CSS com dpr 3, dpr:2 pedia um canvas de 1760 px de altura —
   * ou seja um asset de 1760 px de lado para ser nativo, o que ninguém
   * quer descarregar. 1.5 mantém o canvas em ~1320 px e a ampliação
   * do tier mobile em ~1.2x, invisível num render 3D em movimento.
   */
  const dpr = Math.min(window.devicePixelRatio || 1, narrow ? 1.5 : 2);

  /* --- Capacidade de RENDER (CPU/GPU) -----------------------------
     Fallbacks OTIMISTAS: a ausência da API significa "desconhecido",
     não "fraco". `deviceMemory` só existe em Chromium — assumir 4 GB
     despromovia todo o Safari e Firefox. */
  const cores = navigator.hardwareConcurrency ?? 8;
  const ram = navigator.deviceMemory ?? 8;
  const weak = cores < 4 || ram < 4;

  /* --- Capacidade de REDE ----------------------------------------
     `effectiveType` é pouco fiável no arranque: reporta 2g/slow-2g
     antes de haver medição real. Por isso NÃO é usado — só o
     save-data, que é uma escolha explícita do utilizador. */
  const saveData = navigator.connection?.saveData === true;

  const tier = reducedMotion ? 'static' : weak ? 'lite' : 'full';

  return {
    reducedMotion,
    tier,
    dpr,
    /* Tier de asset pela LARGURA CSS, não por pixels de dispositivo: é
       a largura que distingue um telefone de um portátil, e é a banda
       que se quer poupar. Device pixels punham todo o telefone moderno
       no tier desktop, que é o oposto do objetivo. */
    asset: narrow || saveData ? 'mobile' : 'desktop',
    /** Blur por palavra: o efeito mais caro do painel claro. */
    blur: tier === 'full',
    /** Rasto de partículas do cursor: custa CPU por frame. */
    shatter: tier === 'full' && mq('(pointer: fine)'),
    /** Quantos fetches de frame em paralelo. */
    concurrency: saveData ? 3 : weak ? 4 : 10,
  };
}
