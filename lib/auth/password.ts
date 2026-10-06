import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

const KEY_LEN = 32;
const SALT_LEN = 16;

/** Stored format: `scrypt$<salt hex>$<key hex>`. */
export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(SALT_LEN);
  const key = await scrypt(plain, salt, KEY_LEN);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 3) return false;

  const [algo, saltHex, keyHex] = parts;
  if (algo !== 'scrypt' || !saltHex || !keyHex) return false;

  const expected = Buffer.from(keyHex, 'hex');
  // Buffer.from ignores trailing garbage rather than throwing, so check the
  // decoded length instead of trusting the input.
  if (expected.length !== KEY_LEN) return false;

  const actual = await scrypt(plain, Buffer.from(saltHex, 'hex'), KEY_LEN);
  return timingSafeEqual(actual, expected);
}

/**
 * SECURITY: run this on the unknown-email path so "no such account" and "wrong
 * password" cost the same wall-clock time. Without it, response timing
 * enumerates which email addresses have accounts — a login form that leaks its
 * user list is a poor advertisement for an authentication reference app.
 */
const DUMMY_HASH = `scrypt$${'0'.repeat(SALT_LEN * 2)}$${'0'.repeat(KEY_LEN * 2)}`;

export async function dummyVerify(plain: string): Promise<void> {
  await verifyPassword(plain, DUMMY_HASH);
}
