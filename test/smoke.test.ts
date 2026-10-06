import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

describe('toolchain', () => {
  it('resolves the @ alias into the project', async () => {
    const mod = await import('@/app/page');
    expect(typeof mod.default).toBe('function');
  });

  it('defines every brand colour token exactly as the spec fixes them', () => {
    const css = readFileSync('app/globals.css', 'utf8');
    for (const [token, value] of [
      ['--color-paper', '#fbf7f0'],
      ['--color-surface', '#ffffff'],
      ['--color-ink', '#1b2620'],
      ['--color-spruce', '#2e5a4b'],
      ['--color-ember', '#c0572f'],
      ['--color-muted', '#7a8479'],
      ['--color-rule', '#e3dccd'],
    ]) {
      expect(css, token).toContain(`${token}: ${value}`);
    }
  });

  it('uses no system font stack as the primary display or UI face', () => {
    const css = readFileSync('app/globals.css', 'utf8');
    expect(css).toContain('--font-fraunces');
    expect(css).toContain('--font-figtree');
  });
});
