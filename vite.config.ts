import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],
  server: { port: 1420, strictPort: true, host: '127.0.0.1' },
  build: {
    outDir: 'dist/web',
    rolldownOptions: mode === 'e2e' ? { input: ['index.html', 'gallery.html'] } : undefined,
  },
  clearScreen: false,
}));
