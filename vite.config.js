import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  root: 'src',
  base: './',
  build: {
    outDir: path.resolve(__dirname, 'build/renderer/main_window'),
    emptyOutDir: true
  }
});
