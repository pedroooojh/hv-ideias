/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: { port: 5173 },
  build: {
    rollupOptions: {
      output: {
        // Separa as bibliotecas (mudam pouco) do código do app, para melhor cache.
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          supabase: ['@supabase/supabase-js'],
          vendor: ['@tanstack/react-query', '@radix-ui/react-dialog', 'lucide-react'],
        },
      },
    },
  },
  test: {
    // Testes de banco rodam o schema real em Postgres embutido (PGlite).
    testTimeout: 60_000,
    hookTimeout: 60_000,
    environmentMatchGlobs: [['src/**', 'jsdom']],
    setupFiles: ['./tests/setup.ts'],
  },
});
