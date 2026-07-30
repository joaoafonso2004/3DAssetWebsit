# Exportar do Blender para o scroll

Tu fazes a animação. Este documento é o contrato: o que o site precisa
de receber, e as armadilhas que não são óbvias até estarem a arder.

---

## 1. O ASPECT RATIO — a que dá mais problemas

O canvas desenha a sequência com **`cover`**: preenche o viewport todo e
corta o que sobra. Uma fonte quadrada num ecrã 16:9 mostra **56.9% da
sua altura**. Os outros 43.1% são cortados e nunca vistos.

Foi exatamente isto que fez a primeira mão parecer "demasiado zoomed
in": estava bem enquadrada no quadrado, e o site deitava fora metade.

**Regra: enquadra na proporção em que vai ser visto, não no render.**

Duas opções, e recomendo a primeira:

### A. Renderizar duas proporções (recomendado)

| Tier | Resolução | Proporção | Onde é usado |
|---|---|---|---|
| desktop | 1600×900 | 16:9 | `innerWidth > 700` |
| mobile | 1080×1920 | 9:16 | `innerWidth <= 700` |

Animas uma vez. Renderizas duas, mudando só a resolução e reenquadrando
a câmara. Zero pixels desperdiçados e o enquadramento é o que desenhaste
nos dois casos.

### B. Quadrado com zona segura

Se só quiseres um render: **1600×1600**, com o sujeito inteiramente
dentro da **banda central de 57% da altura**. Ou seja, deixa 21.5% de ar
morto em cima e em baixo. Simples de fazer: no Blender, `View → Viewport
Render Region` ou passepartout com a câmara a 16:9 para veres a zona
segura enquanto animas.

---

## 2. Movimento

**Roda o sujeito.** É o ponto do efeito. Uma câmara que só faz dolly em
linha reta lê-se como zoom de imagem, não como 3D. No vídeo de
referência a cabeça orbita e inclina ao longo do scroll — é isso que
vende que aquilo é um objeto no espaço.

Um arco de 40–70° ao longo dos 150 frames chega. Combina com o push-in.

**Sem trechos mortos.** Numa sequência de scroll não há pausas: se a
câmara parar 20 frames, o utilizador scrolla e não acontece nada, e a
página parece encravada. Movimento contínuo do frame 1 ao último.

**Todas as keyframes LINEAR.** O Blender põe Bézier por omissão. O
timing vem do scroll (GSAP scrub); se houver easing também no Blender,
ficam dois easings sobrepostos e o scrubbing fica elástico.

> No Graph Editor: `A` para selecionar tudo → `T` → *Linear*.
> Ou muda o default em `Preferences → Animation → Default Interpolation`.

---

## 3. Output

| Definição | Valor | Porquê |
|---|---|---|
| `Film → Transparent` | ✅ | é o que faz o gradiente do site ler-se por baixo |
| Formato | PNG | |
| Color | **RGBA** | sem isto perdes o alpha e ficas com um retângulo colado |
| Color Depth | 8 | |
| Frame Start / End | 1 / 150 | contíguo, sem buracos |
| FPS | 30 | irrelevante para o scroll, mas mantém o preview coerente |

**Numeração contígua a partir de 1**: `frame_0001.png` … `frame_0150.png`.
O loader faz `padStart(4, '0')`. Um frame em falta é resolvido pelo
vizinho; vários seguidos dão saltos visíveis.

**Color Management:** `View Transform → Standard`. AgX/Filmic escurecem e
dessaturam — num asset branco isso mata o branco.

---

## 4. Quantos frames

O que importa não é o número — é **quantos pixels de scroll cada frame
aguenta**. Abaixo de ~14 px/frame gastas banda que ninguém vê; acima de
~22 px/frame começa a ver-se aos degraus.

Com 3 legendas de 118svh e viewport de 800 px, a corrida é ≈2830 px:

| Frames | px/frame | |
|---|---|---|
| 120 | 23.6 | já se nota |
| **150** | **18.9** | **certo** |
| 180 | 15.7 | mais liso, +20% de peso |

Se mudares o número, muda `TOTAL_FRAMES` em
[sequence-config.js](src/scripts/lib/sequence-config.js).

---

## 5. Entregar ao site

```bash
# 1. PNGs do Blender para ./raw-seq/
# 2. converter para WebP nos dois tiers
npm run seq:encode
```

```bash
# 3. incrementar a versão em src/scripts/lib/sequence-config.js
#    SEQ_VERSION = 'hand-2'
npm run dev
```

**O passo 3 não é opcional.** Sem mudar `SEQ_VERSION`, quem já abriu o
site continua a receber os frames antigos da cache do browser — foi
exatamente o que aconteceu quando a mão substituiu o placeholder e só o
primeiro frame mudava.

---

## 6. Verificar antes de dar por feito

```bash
python -c "from PIL import Image; im=Image.open('raw-seq/frame_0075.png'); print(im.mode, im.size)"
```

Tem de dizer `RGBA`.

```bash
ffmpeg -framerate 30 -i raw-seq/frame_%04d.png -vf format=yuv420p -y preview.mp4
```

Vê o `preview.mp4`. **Se o movimento for interessante a 30 fps
constantes, vai ser interessante no scroll.** Se tiver um trecho morto a
meio, o scroll vai ter um trecho morto a meio. É o teste mais barato que
existe e apanha quase tudo.

---

## 7. O script antigo

[`tools/blender_hand_sequence.py`](tools/blender_hand_sequence.py) faz
tudo isto por código (importa, normaliza, materiais, luz, câmara, render).
Fica como referência ou para automatizar re-renders, mas para direção de
arte o viewport ganha sempre. O que aprendi a fazer nele e vale a pena
roubar:

- **Luz**: key pequena e rasante (não uma softbox enorme e frontal), key
  260 W, mundo a 0.35, exposição −0.9. O que dá volume ao branco é a
  sombra, não a luz. A primeira versão estava estourada e a mão lia-se
  como uma luva.
- **Material**: Principled branco com `Subsurface Weight 0.16` — sem
  isso o branco fica morto, como plástico.
- **Liquido**: cloth **não** serve. Pano com pouca tensão abre em
  painéis planos com vincos rectos; renderizou um lençol. O que faz
  gotas com ponta arredondada é tensão superficial → **Mantaflow FLIP**,
  com `surface_tension ≈ 0.30` e `viscosity ≈ 0.08`. Custa minutos de
  bake em vez de segundos.
- **Colisão**: nunca contra a malha de 1.19M tris. Faz uma cópia
  decimada a ~6k como effector e esconde-a do render.
