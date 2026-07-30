# SiteNext

Recriação do layout e do comportamento de scroll analisados em `d.mov`:
Lenis + GSAP/ScrollTrigger + sequência de frames em Canvas 2D, sobre Astro.

## Arrancar

```bash
npm install
```

Para ver a página a funcionar **já**, sem passar pelo Blender, há uma
sequência sintética (forma metaball a agitar-se e a escorrer) que valida
loader, scrub, pin e enquadramento:

```bash
npm run seq:placeholder
```

```bash
npm run dev
```

Para o asset a sério, ver [BLENDER.md](BLENDER.md) — resumo:

```bash
blender -b -P tools/blender_liquid_sequence.py -- --frames 150 --res 1600 --out ./raw-seq
```

```bash
npm run seq:encode
```

```bash
npm run dev
```

## Mapa

```
src/
  pages/index.astro          composição da página
  layouts/Base.astro         head, fontes, preload do 1.º frame
  components/
    Chrome.astro             nav + HUD fixo (inverte com [data-hud])
    Caption.astro            bloco de legenda que corre sobre o palco
  styles/
    tokens.css               cores, escala tipográfica, easings
    global.css               reset + todos os componentes
  scripts/
    main.js                  boot e ordem de arranque
    lib/env.js               deteção de capacidade → tier de asset e efeitos
    lib/smooth-scroll.js     Lenis + ligação ao ticker do GSAP
    lib/frame-sequence.js    loader em escada + desenho no canvas
    lib/kinetic-text.js      revelação palavra a palavra
    lib/scenes.js            ScrollTriggers (sequência, legendas, HUD, progresso)
tools/
  blender_liquid_sequence.py gera a sequência
  encode-sequence.mjs        PNG RGBA → WebP em dois tiers
  make-placeholder-seq.mjs   sequência sintética para testar sem Blender
```

## Os três valores que vais querer mexer

| Valor | Onde | Efeito |
|---|---|---|
| `LERP = 0.055` | `lib/smooth-scroll.js` | inércia do scroll. Medida do vídeo; sobe para `0.075` se quiseres mais reativo |
| `TOTAL_FRAMES = 150` | `scripts/main.js` | tem de ser igual ao `frame_end` do Blender |
| `SCATTER` | `lib/kinetic-text.js` | amplitude do caos inicial das palavras |

## Notas sobre a fidelidade ao vídeo

- **Inércia:** obtida por medição, não por estimativa. Segui a aresta do
  painel claro frame a frame; a desaceleração dá `lerp ≈ 0.053`. O
  raciocínio completo está em comentário no `smooth-scroll.js`.
- **Copy:** o parágrafo do manifesto é transcrição literal. O texto de
  apoio das legendas 2 e 3 é ilegível no vídeo (a gravação é de um
  monitor filmado, ~466 px de largura útil) — está escrito por
  aproximação e é substituível sem tocar em código.
- **Cores:** o vídeo é uma filmagem de um ecrã, logo os hex em
  `tokens.css` reconstroem o *rácio* medido (palco cinza-médio quente →
  painel quase branco), não uma leitura colorimétrica.
- **Pin:** feito com `position: sticky`, não com `ScrollTrigger.pin`.
  Sem pin-spacer, sem reflow em resize.
