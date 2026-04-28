import { defineConfig } from 'vite';

export default defineConfig({
  base: process.env.GITHUB_PAGES ? '/bada/' : './',
  server: { host: true },
  build: {
    target: 'es2020',
    outDir: 'dist',
  },
});
