import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [vue()],
  resolve: { alias: { '@shike/shared': fileURLToPath(new URL('./packages/shared/src/index.ts', import.meta.url)) } },
  test: { include: ['packages/**/*.test.ts'], environment: 'node', testTimeout: 10_000 },
});
