/**
 * Prints a signing key suitable for NORTHBOUND_SIGNING_KEY.
 *
 *   pnpm oauth:keygen
 *
 * Needed for any deployment whose filesystem is ephemeral — on Vercel a
 * generated data/keys.json does not survive, so two instances would sign with
 * different keys and reject each other's tokens.
 */
import { createHash } from 'node:crypto';
import { generateKeyPair, exportJWK } from 'jose';

const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
const privateJwk = await exportJWK(privateKey);
const publicJwk = await exportJWK(publicKey);

const kid = createHash('sha256')
  .update(JSON.stringify({ e: publicJwk.e, kty: publicJwk.kty, n: publicJwk.n }))
  .digest('base64url')
  .slice(0, 16);

console.error('# Set this in your deployment environment. Never commit it.');
console.error('# NORTHBOUND_SIGNING_KEY=<the single line below>');
console.log(JSON.stringify({ privateJwk, publicJwk, kid }));
