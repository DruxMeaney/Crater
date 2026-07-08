import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // rutas relativas: el mismo build funciona en Vercel y bajo file:// en Electron
  base: './',
  plugins: [react()],
});
