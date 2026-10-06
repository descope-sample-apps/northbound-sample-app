import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword, dummyVerify } from '@/lib/auth/password';

describe('password hashing', () => {
  it('round-trips a correct password', async () => {
    const stored = await hashPassword('correct horse battery staple');
    expect(await verifyPassword('correct horse battery staple', stored)).toBe(true);
  });

  it('rejects a wrong password', async () => {
    const stored = await hashPassword('correct horse battery staple');
    expect(await verifyPassword('wrong password', stored)).toBe(false);
  });

  it('salts, so the same password hashes differently each time', async () => {
    expect(await hashPassword('same')).not.toBe(await hashPassword('same'));
  });

  it('returns false rather than throwing on a malformed stored value', async () => {
    for (const bad of ['not-a-hash', '', 'bcrypt$aa$bb', 'scrypt$zz', 'scrypt$$']) {
      expect(await verifyPassword('x', bad), bad).toBe(false);
    }
  });

  it('returns false when the stored key is the wrong length', async () => {
    expect(await verifyPassword('x', `scrypt$${'0'.repeat(32)}$${'0'.repeat(10)}`)).toBe(false);
  });

  it('dummyVerify resolves without throwing', async () => {
    await expect(dummyVerify('anything')).resolves.toBeUndefined();
  });
});
