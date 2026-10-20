import { defineConfig } from 'vite';

export default defineConfig({
  // relative asset paths so the built page loads from disk inside Electron
  base: './',
  build: { chunkSizeWarningLimit: 2000 },
});
