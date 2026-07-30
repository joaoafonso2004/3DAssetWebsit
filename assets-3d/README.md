# assets-3d

Input de build. **Nunca é servido ao browser** — não mover para `public/`.

Põe aqui o ficheiro 3D (`.obj`, `.glb`, `.fbx` ou `.blend`). O script do
Blender importa daqui, normaliza escala e centragem, faz remesh se a
topologia for de sculpt, aplica o material branco e simula o escorrer.

O que sai daqui vai para `raw-seq/` (PNG RGBA) e depois para
`public/seq/` (WebP), via:

```
npm run seq:render
npm run seq:encode
```

Não te preocupes com escala nem orientação — é normalizado em código.
