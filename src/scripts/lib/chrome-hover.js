/**
 * Revelação cromada por silhueta para uma sequência Canvas 2D.
 *
 * A composição é feita apenas num quadrado local à volta do cursor:
 *   chrome × alpha do frame base × máscara orgânica
 * Assim o cromado nunca pode sair da silhueta, mesmo nas órbitas,
 * dentes ou contornos semi-transparentes.
 */

const pad = (n, width = 4) => String(n).padStart(width, '0');

function ladder(total, strides = [24, 8, 4, 2, 1]) {
  const seen = new Uint8Array(total);
  const passes = [];
  for (const stride of strides) {
    const pass = [];
    for (let i = 0; i < total; i += stride) {
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

function blobToImage(blob) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(blob);
    image.decoding = 'async';
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Não foi possível descodificar o frame cromado.'));
    };
    image.src = objectUrl;
  });
}

const clamp01 = (value) => (value < 0 ? 0 : value > 1 ? 1 : value);
const smoothstep = (value) => value * value * (3 - 2 * value);

export function createChromeHover({
  canvas,
  sequence,
  total,
  dir,
  ext = 'webp',
  version = '',
  concurrency = 4,
  pixelRatio = 1,
  reducedMotion = false,
  radius = [72, 122],
}) {
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  if (!finePointer) {
    return {
      load: () => Promise.resolve(),
      tick() {},
      rest() {},
      setActive() {},
      destroy() {},
    };
  }

  const frames = new Array(total).fill(null);
  const suffix = version ? `?v=${version}` : '';
  const frameUrl = (i) => `${dir}/frame_${pad(i + 1)}.${ext}${suffix}`;

  // O buffer de efeito guarda só a região da mancha. A máscara é ainda
  // menor e é ampliada com smoothing; além de barato, isto amacia o edge.
  const effect = document.createElement('canvas');
  const effectCtx = effect.getContext('2d', {
    alpha: true,
    desynchronized: true,
  });
  const field = document.createElement('canvas');
  const fieldCtx = field.getContext('2d', { alpha: true });

  // Contorno reutilizado da mancha. É uma curva orgânica, não um
  // conjunto de círculos: os harmónicos deformam cada setor de maneira
  // diferente e fazem a forma parecer alastrar pela superfície.
  const POINT_COUNT = 24;
  const pointX = new Float32Array(POINT_COUNT);
  const pointY = new Float32Array(POINT_COUNT);

  let currentFrame = 0;
  let requestedFrame = 0;
  let phase = 0;
  let lastTime = performance.now() / 1000;
  let pointerX = 0;
  let pointerY = 0;
  let renderX = 0;
  let renderY = 0;
  let hasPosition = false;
  let pointerInCanvas = false;
  let opacity = 0;
  let targetOpacity = 0;
  let active = true;
  let destroyed = false;

  async function fetchFrame(i) {
    if (frames[i] || destroyed) return;
    try {
      const response = await fetch(frameUrl(i));
      if (!response.ok) throw new Error(String(response.status));
      const blob = await response.blob();
      frames[i] =
        typeof createImageBitmap === 'function'
          ? await createImageBitmap(blob)
          : await blobToImage(blob);
      if (i === requestedFrame) sequence.requestPaint();
    } catch {
      // Um frame em falta é substituído pelo vizinho mais próximo.
    }
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

  function load() {
    const passes = ladder(total);
    const first = runPass(passes[0]);
    first.then(async () => {
      for (let i = 1; i < passes.length && !destroyed; i += 1) {
        await runPass(passes[i]);
      }
    });
    return first;
  }

  function nearest(i) {
    if (frames[i]) return frames[i];
    for (let distance = 1; distance < total; distance += 1) {
      if (i - distance >= 0 && frames[i - distance]) return frames[i - distance];
      if (i + distance < total && frames[i + distance]) return frames[i + distance];
    }
    return null;
  }

  function updatePointer(event) {
    const rect = canvas.getBoundingClientRect();
    const inside =
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom &&
      rect.width > 0 &&
      rect.height > 0;

    pointerInCanvas = inside;
    if (!inside) return;

    pointerX = (event.clientX - rect.left) * (canvas.width / rect.width);
    pointerY = (event.clientY - rect.top) * (canvas.height / rect.height);

    if (!hasPosition) {
      renderX = pointerX;
      renderY = pointerY;
      hasPosition = true;
    }
  }

  function leaveWindow() {
    pointerInCanvas = false;
  }

  window.addEventListener('pointermove', updatePointer, { passive: true });
  document.documentElement.addEventListener('pointerleave', leaveWindow, {
    passive: true,
  });

  /**
   * Desenha uma mancha de contorno irregular a baixa resolução.
   *
   * Três frequências não sincronizadas deformam a fronteira. A forma
   * também estica, roda e expande de modo independente, portanto nunca
   * resolve visualmente para um círculo, nem com o cursor parado.
   */
  function paintOrganicField(size, maxRadius, intensity) {
    const fieldSize = Math.max(96, Math.min(224, Math.round(size * 0.34)));
    if (field.width !== fieldSize || field.height !== fieldSize) {
      field.width = fieldSize;
      field.height = fieldSize;
    } else {
      fieldCtx.clearRect(0, 0, fieldSize, fieldSize);
    }

    const scale = fieldSize / size;
    const center = fieldSize * 0.5;
    const pulse = reducedMotion
      ? 1
      : 1 + Math.sin(phase * 0.81) * 0.08 + Math.sin(phase * 1.37) * 0.035;
    const spread = 0.48 + smoothstep(intensity) * 0.52;
    const base = maxRadius * scale * 0.68 * pulse * spread;
    const stretchX = reducedMotion ? 1.08 : 1.08 + Math.sin(phase * 0.43) * 0.1;
    const stretchY = reducedMotion ? 0.84 : 0.84 + Math.cos(phase * 0.57) * 0.09;
    const rotation = reducedMotion ? -0.12 : Math.sin(phase * 0.31) * 0.24 - 0.12;
    const cosRotation = Math.cos(rotation);
    const sinRotation = Math.sin(rotation);
    const driftX = reducedMotion ? 0 : Math.sin(phase * 0.53) * base * 0.08;
    const driftY = reducedMotion ? 0 : Math.cos(phase * 0.37) * base * 0.065;

    for (let i = 0; i < POINT_COUNT; i += 1) {
      const angle = (i / POINT_COUNT) * Math.PI * 2;
      const noise =
        1 +
        Math.sin(angle * 3 + phase * 0.67) * 0.18 +
        Math.sin(angle * 5 - phase * 0.91) * 0.11 +
        Math.sin(angle * 8 + phase * 1.19) * 0.055 +
        Math.sin(angle * 2 - phase * 0.29) * 0.045;
      const localX = Math.cos(angle) * base * noise * stretchX;
      const localY = Math.sin(angle) * base * noise * stretchY;
      pointX[i] =
        center + driftX + localX * cosRotation - localY * sinRotation;
      pointY[i] =
        center + driftY + localX * sinRotation + localY * cosRotation;
    }

    // Curvas quadráticas pelos pontos médios: fronteira contínua, sem
    // os vértices visíveis de um polígono.
    const firstMidX = (pointX[POINT_COUNT - 1] + pointX[0]) * 0.5;
    const firstMidY = (pointY[POINT_COUNT - 1] + pointY[0]) * 0.5;
    fieldCtx.beginPath();
    fieldCtx.moveTo(firstMidX, firstMidY);
    for (let i = 0; i < POINT_COUNT; i += 1) {
      const next = (i + 1) % POINT_COUNT;
      fieldCtx.quadraticCurveTo(
        pointX[i],
        pointY[i],
        (pointX[i] + pointX[next]) * 0.5,
        (pointY[i] + pointY[next]) * 0.5
      );
    }
    fieldCtx.closePath();
    fieldCtx.filter = `blur(${Math.max(4, fieldSize * 0.038)}px)`;
    fieldCtx.fillStyle = 'rgba(255,255,255,1)';
    fieldCtx.fill();
    fieldCtx.filter = 'none';
    fieldCtx.globalCompositeOperation = 'source-over';
  }

  function overlay(ctx, baseFrame, frameIndex, dx, dy, dw, dh, cw, ch) {
    requestedFrame = frameIndex;
    currentFrame = frameIndex;
    if (opacity <= 0.001 || !hasPosition) return;

    const chromeFrame = nearest(frameIndex);
    if (!chromeFrame) return;

    const minRadius = radius[0] * pixelRatio;
    const maxRadius = radius[1] * pixelRatio;
    const mutation =
      reducedMotion
        ? 1
        : 1 + Math.sin(phase * 0.83) * 0.055 + Math.sin(phase * 1.71) * 0.025;
    const localRadius = maxRadius * mutation;
    // Tamanho fixo para nunca realocar o bitmap da canvas durante o rAF.
    // A folga contém os lóbulos mais longos e o blur sem cortar o edge.
    const size = Math.ceil(maxRadius * 2.75);

    if (effect.width !== size || effect.height !== size) {
      effect.width = size;
      effect.height = size;
      effectCtx.imageSmoothingEnabled = true;
      effectCtx.imageSmoothingQuality = 'high';
    } else {
      effectCtx.clearRect(0, 0, size, size);
    }

    const left = renderX - size * 0.5;
    const top = renderY - size * 0.5;

    // 1. Mesmo transform do frame base, transladado para o buffer local.
    effectCtx.globalCompositeOperation = 'source-over';
    effectCtx.globalAlpha = 1;
    effectCtx.drawImage(chromeFrame, dx - left, dy - top, dw, dh);

    // 2. Recorte pixel-perfect pela alpha da caveira base.
    effectCtx.globalCompositeOperation = 'destination-in';
    effectCtx.drawImage(baseFrame, dx - left, dy - top, dw, dh);

    // 3. Recorte pela mancha orgânica, com edge largo e ultra suave.
    paintOrganicField(size, Math.max(minRadius, localRadius), opacity);
    effectCtx.drawImage(field, 0, 0, size, size);

    // 4. Composição final. O fade atua sobre toda a passagem cromada.
    effectCtx.globalCompositeOperation = 'source-over';
    ctx.save();
    ctx.globalAlpha = smoothstep(clamp01(opacity));
    ctx.drawImage(effect, left, top);
    ctx.restore();
  }

  sequence.setOverlay(overlay);

  /**
   * Único update por rAF. O teste de silhueta é refeito mesmo com o rato
   * parado, porque o scroll pode mover outro frame por baixo do cursor.
   */
  function tick(time) {
    if (destroyed) return;
    const now = typeof time === 'number' ? time : performance.now() / 1000;
    const dt = Math.min(0.05, Math.max(0, now - lastTime));
    lastTime = now;

    targetOpacity =
      active &&
      pointerInCanvas &&
      hasPosition &&
      sequence.isOpaqueAt(pointerX, pointerY)
        ? 1
        : 0;

    const positionEase = 1 - Math.exp(-dt * 18);
    renderX += (pointerX - renderX) * positionEase;
    renderY += (pointerY - renderY) * positionEase;

    // Entrada deliberada, saída um pouco mais lenta para um fade luxuoso.
    const fadeSpeed = targetOpacity > opacity ? 10.5 : 6.5;
    opacity += (targetOpacity - opacity) * (1 - Math.exp(-dt * fadeSpeed));
    if (opacity < 0.001 && targetOpacity === 0) opacity = 0;

    if (!reducedMotion) phase += dt;

    if (
      opacity > 0 ||
      targetOpacity > 0 ||
      Math.abs(pointerX - renderX) > 0.1 ||
      Math.abs(pointerY - renderY) > 0.1
    ) {
      sequence.requestPaint();
    }
  }

  return {
    load,
    tick,
    rest() {
      targetOpacity = 0;
      opacity = 0;
      sequence.requestPaint();
    },
    setActive(on) {
      active = on;
      if (!on) {
        targetOpacity = 0;
        opacity = 0;
        sequence.requestPaint();
      }
    },
    destroy() {
      destroyed = true;
      window.removeEventListener('pointermove', updatePointer);
      document.documentElement.removeEventListener('pointerleave', leaveWindow);
      sequence.setOverlay(null);
      frames.forEach((frame) => frame?.close?.());
    },
    get frame() {
      return currentFrame;
    },
  };
}
