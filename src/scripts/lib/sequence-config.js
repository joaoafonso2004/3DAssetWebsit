/**
 * Config da sequência, partilhada entre o layout (que faz preload do
 * primeiro frame) e o loader. Um sítio só: se o preload e o loader
 * pedirem URLs diferentes, o frame 1 é descarregado duas vezes.
 */

/**
 * Tem de ser igual ao `frame_end` do render do Blender.
 *
 * Regra: 14–22 px de scroll por frame. Com 3 legendas de 118svh
 * (~354svh de corrida) e viewport de 800 px dá ~2830 px:
 *   150 frames -> 18.9 px/frame  (bom)
 *   180 frames -> 15.7 px/frame  (mais liso, +20 % de peso)
 */
export const TOTAL_FRAMES = 150;

export const SEQ_EXT = 'webp';

/**
 * INCREMENTA sempre que re-renderizares no Blender.
 *
 * Vai para o URL como `?v=`. Sem isto, quem já visitou o site continua
 * a receber os frames antigos da cache — foi o que aconteceu ao trocar
 * o placeholder pela mão.
 */
export const SEQ_VERSION = 'cranio-1';
export const CHROME_SEQ_VERSION = 'cranio-chrome-1';

export const seqDir = (tier) => `/seq/${tier}`;
export const chromeSeqDir = (tier) => `/seq-chrome/${tier}`;

export const seqUrl = (tier, i) =>
  `${seqDir(tier)}/frame_${String(i + 1).padStart(4, '0')}.${SEQ_EXT}` +
  (SEQ_VERSION ? `?v=${SEQ_VERSION}` : '');
