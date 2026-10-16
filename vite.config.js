import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import pkg from './package.json' with { type: 'json' };

export default defineConfig({
  root: 'web',
  plugins: [react()],
  // Builds on Vercel are the shared team version (see api/ and README "Team version").
  define: { __APP_VERSION__: JSON.stringify(pkg.version), __TEAM__: JSON.stringify(process.env.VERCEL === '1') },
  build: { outDir: '../dist', emptyOutDir: true },
  server: {
    host: true,
    port: 5173,
    proxy: { '/api': 'http://127.0.0.1:3462' },
  },
});
