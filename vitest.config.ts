import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    // .tsx is included deliberately: component tests live alongside service
    // tests, and a glob that silently excluded them would let those tests
    // "pass" by never running.
    include: ['test/**/*.test.{ts,tsx}'],
    pool: 'forks',
  },
  resolve: { alias: { '@': path.resolve(import.meta.dirname, '.') } },
});
