# João Afonso — 3D Asset Website

Website experimental que desenvolvi para explorar animação 3D controlada por
scroll, transições cinematográficas e interação em Canvas 2D.

**Live:** [3dassetwebsiteja.vercel.app](https://3dassetwebsiteja.vercel.app/)

## Sobre o projeto

O elemento principal é uma sequência de 150 frames de uma caveira 3D. O frame
apresentado acompanha a posição do scroll, criando a sensação de controlar
diretamente a animação.

Também criei uma segunda sequência com acabamento cromado. No computador, o
efeito aparece ao passar o cursor sobre a caveira. Em mobile, funciona através
de toque e arrasto. A revelação é limitada à silhueta do modelo e usa uma
máscara orgânica em movimento para evitar o aspeto de um gradiente circular.

Outros detalhes do projeto:

- scroll suave com Lenis;
- animações e sincronização com GSAP e ScrollTrigger;
- sequência de imagens renderizada em Canvas 2D;
- carregamento progressivo dos frames;
- texto cinético e transições ligadas ao scroll;
- layout responsivo e interação tátil;
- suporte para `prefers-reduced-motion`.

## Tecnologias

- Astro
- JavaScript
- GSAP
- ScrollTrigger
- Lenis
- Canvas API
- Sharp

## Executar localmente

```bash
git clone https://github.com/joaoafonso2004/3DAssetWebsit.git
cd 3DAssetWebsit
npm install
npm run dev
```

O projeto fica disponível em `http://localhost:4321`.

Para gerar a versão de produção:

```bash
npm run build
npm run preview
```

## Sequências de imagens

As sequências usadas pelo site estão organizadas em duas versões:

- `public/seq` — material base;
- `public/seq-chrome` — material cromado usado na interação.

Cada sequência tem assets separados para desktop e mobile. Os ficheiros WebP
podem ser novamente processados com:

```bash
npm run seq:encode
npm run seq:encode:chrome
```

## Estrutura principal

```text
src/
  components/        componentes da interface
  layouts/           estrutura base da página
  pages/             página principal
  scripts/           animações, scroll e Canvas
  styles/            estilos globais e variáveis
public/
  seq/               sequência base
  seq-chrome/        sequência cromada
tools/               scripts para preparar os frames
```
