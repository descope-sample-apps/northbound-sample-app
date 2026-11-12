import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { identifyAgent, resetAgentProductCache } from '@/lib/agentSession/agentProducts';

const MUSE = 'cli_muse_8f3Kd2';
const DOTS = 'cli_dots_7bW1nT';

function configure(value: string | undefined) {
  if (value === undefined) delete process.env.AGENT_CLIENTS;
  else process.env.AGENT_CLIENTS = value;
  resetAgentProductCache();
}

beforeEach(() => configure(JSON.stringify({
  [MUSE]: { name: 'Muse', domain: 'muse.ai' },
  [DOTS]: { name: 'Dots', domain: 'openai.com' },
})));
afterEach(() => configure(undefined));

describe('naming the product behind a client ID', () => {
  it('names a client the store knows', () => {
    expect(identifyAgent(MUSE)).toEqual({ name: 'Muse', domain: 'muse.ai' });
    expect(identifyAgent(DOTS)).toEqual({ name: 'Dots', domain: 'openai.com' });
  });

  // The honest answer for a client nobody configured. A customer is better served by
  // "third-party agent, here is its ID" than by a name the store invented.
  it('returns null for a client it has never heard of', () => {
    expect(identifyAgent('cli_someone_else')).toBeNull();
  });

  it('knows nothing when AGENT_CLIENTS is unset', () => {
    configure(undefined);
    expect(identifyAgent(MUSE)).toBeNull();
  });
});

describe('a broken setting costs the names, not the page', () => {
  it('survives a value that is not JSON', () => {
    configure('Muse = muse.ai');
    expect(identifyAgent(MUSE)).toBeNull();
  });

  it('survives a JSON array instead of an object', () => {
    configure('[{"name": "Muse"}]');
    expect(identifyAgent(MUSE)).toBeNull();
  });

  // One bad entry must not take the good ones with it.
  it('keeps the usable entries and drops the rest', () => {
    configure(JSON.stringify({
      [MUSE]: { name: 'Muse', domain: 'muse.ai' },
      [DOTS]: { name: 'Dots' },            // no domain
      cli_empty: { name: '', domain: 'x' }, // empty name
    }));
    expect(identifyAgent(MUSE)).toEqual({ name: 'Muse', domain: 'muse.ai' });
    expect(identifyAgent(DOTS)).toBeNull();
    expect(identifyAgent('cli_empty')).toBeNull();
  });
});

describe('the cache follows the setting', () => {
  it('picks up a changed value rather than serving the old one', () => {
    expect(identifyAgent(MUSE)?.name).toBe('Muse');
    configure(JSON.stringify({ [MUSE]: { name: 'Renamed', domain: 'muse.ai' } }));
    expect(identifyAgent(MUSE)?.name).toBe('Renamed');
  });
});
