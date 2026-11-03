import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Calls to /api go to the backend, so there are no CORS problems in development
    proxy: { '/api': 'http://localhost:4000' },
  },
});