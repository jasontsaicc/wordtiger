import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [WxtVitest(), vue()],
  test: { environment: 'jsdom' },
});
