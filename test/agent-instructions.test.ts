import { describe, it, expect } from 'vitest';

const ISSUER = 'https://shop.example';
const req = () => new Request(`${ISSUER}/auth.md`);

async function body(modulePath: string) {
  const mod = await import(modulePath);
  const response = mod.GET(req());
  return { response, text: await response.text() };
}

const PATHS = [
  '@/app/auth.md/route',
  '@/app/.well-known/auth.md/route',
  '@/app/agents.md/route',
];

describe('agent instructions', () => {
  it('is served at all three conventional URLs', async () => {
    for (const path of PATHS) {
      const { response } = await body(path);
      expect(response.status, path).toBe(200);
      expect(response.headers.get('content-type'), path).toMatch(/text\/markdown/);
    }
  });

  it('serves identical content at each', async () => {
    const texts = await Promise.all(PATHS.map(async (p) => (await body(p)).text));
    expect(new Set(texts).size).toBe(1);
  });

  // The single most important thing in the file. An agent that finds a login
  // form will use it unless told not to, and the telling has to come first.
  it('leads with the prohibition, before either option', async () => {
    const { text } = await body(PATHS[0]);

    const prohibition = text.indexOf('Do not use the customer');
    const optionOne = text.indexOf('## Option 1');

    expect(prohibition).toBeGreaterThan(-1);
    expect(prohibition).toBeLessThan(optionOne);
    expect(text).toMatch(/do not.*password/i);
    expect(text).toMatch(/one-time code|forward a sign-in link/i);
  });

  it('names PRM as authoritative and itself as a compatibility layer', async () => {
    const { text } = await body(PATHS[0]);
    expect(text).toContain('/.well-known/oauth-protected-resource');
    expect(text).toMatch(/compatibility layer/i);
    expect(text).toMatch(/authoritative/i);
  });

  it('says plainly that naming a platform proves nothing', async () => {
    const { text } = await body(PATHS[0]);
    expect(text).toMatch(/does not prove/i);
    expect(text).toMatch(/self-declared/i);
    expect(text).toMatch(/read-only/i);
  });

  // An agent that treats step-up as a refusal will report failure to its user
  // when it should be waiting.
  it('tells an agent that step_up_required means wait, not give up', async () => {
    const { text } = await body(PATHS[0]);
    expect(text).toContain('step_up_required');
    expect(text).toMatch(/not\*\* a refusal|not a refusal/i);
    expect(text).toContain('binding_code');
  });

  it('tells the agent to relay the binding code', async () => {
    const { text } = await body(PATHS[0]);
    expect(text).toMatch(/relay.*binding_code/i);
    expect(text).toMatch(/decline/i);
  });

  it('warns off the endpoints no agent may use', async () => {
    const { text } = await body(PATHS[0]);
    expect(text).toContain('payment_methods:write');
    expect(text).toMatch(/granted to nobody|refused for every agent/i);
  });

  it('follows the host it was reached on', async () => {
    const mod = await import(PATHS[0]);
    const text = await mod.GET(new Request('https://tunnel.ngrok.io/auth.md')).text();
    expect(text).toContain('https://tunnel.ngrok.io/api/agent/authorize');
    expect(text).not.toContain('shop.example');
  });
});
