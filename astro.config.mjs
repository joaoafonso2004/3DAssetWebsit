import { defineConfig } from 'astro/config';

export default defineConfig({
  // Zero islands: tudo é HTML/CSS estático + um único módulo JS.
  build: { inlineStylesheets: 'auto' },
  vite: {
    build: {
      // GSAP + Lenis num só chunk: menos round-trips no boot.
      rollupOptions: { output: { manualChunks: { motion: ['gsap', 'lenis'] } } },
    },
  },
});
