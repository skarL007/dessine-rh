import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  publicDir: false,
  build: { outDir: 'public', emptyOutDir: false, sourcemap: false, target: 'es2022', chunkSizeWarningLimit: 350 },
  server: { port: 5173, proxy: { '/api': 'http://localhost:3000' } },
});
