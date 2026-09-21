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
  // tsconfig sets jsx: "preserve" for Next's compiler, which leaves esbuild
  // without a transform for .tsx test files. Component tests render to static
  // markup, so the automatic runtime is all they need — no jsdom, no DOM.
  esbuild: { jsx: 'automatic' },
  resolve: { alias: { '@': path.resolve(import.meta.dirname, '.') } },
});
