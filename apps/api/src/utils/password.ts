/**
 * Password hashing.
 *
 * bcrypt with a configurable cost (12 by default). There is no pepper: a pepper
 * has to live next to the database to be useful at verification time, so it adds
 * operational risk without changing the threat model for a database-only leak.
 *
 * `bcryptjs` is used rather than the native `bcrypt` binding so the API has no
 * node-gyp build step — it is roughly 30% slower, which is acceptable at the
 * pilot's login volume and is absorbed by the rate limiter.
 */

import bcrypt from 'bcryptjs';
import { env } from '../config/env.js';

/**
 * Verification hash used to keep login timing constant when the email does not
 * exist. Computed once at module load against a random password.
 */
let dummyHashPromise: Promise<string> | null = null;

function getDummyHash(): Promise<string> {
  dummyHashPromise ??= bcrypt.hash('never-matching-placeholder-password', env.BCRYPT_ROUNDS);
  return dummyHashPromise;
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, env.BCRYPT_ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    // A malformed hash in the database should read as "wrong password", never
    // as a server error that leaks the row's existence.
    return false;
  }
}

/**
 * Perform a bcrypt comparison against a throwaway hash.
 *
 * Called when the email is unknown so that "user not found" and "wrong password"
 * take the same wall-clock time — otherwise the login endpoint becomes an
 * account-enumeration oracle.
 */
export async function burnPasswordComparison(plain: string): Promise<void> {
  const dummy = await getDummyHash();
  await bcrypt.compare(plain, dummy);
}

/**
 * A password needs rehashing when the cost factor has been raised since the
 * hash was written. Cheap to check (the cost is encoded in the hash prefix) and
 * lets us raise BCRYPT_ROUNDS without a bulk migration — the upgrade happens
 * opportunistically on the next successful login.
 */
export function needsRehash(hash: string): boolean {
  const match = /^\$2[aby]\$(\d{2})\$/.exec(hash);
  if (!match) return true;
  return Number(match[1]) < env.BCRYPT_ROUNDS;
}

export async function rehashOnLogin(
  plain: string,
  existingHash: string,
): Promise<string | null> {
  if (!needsRehash(existingHash)) return null;
  return hashPassword(plain);
}
