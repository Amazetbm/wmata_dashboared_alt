import { defineConfig } from 'vitest/config';
import angular from '@analogjs/vite-plugin-angular';

export default defineConfig({
  plugins: [angular()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['src/test-setup.ts'],
    include: ['src/**/*.spec.ts'],
    // Node 24 throws ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING when jsdom's VM
    // context encounters Angular's dynamic import() calls during template
    // compilation. Using fork-based workers avoids the sandboxed VM context.
    pool: 'forks',
  },
});
