/**
 * Identifier generation and normalisation helpers.
 */

import { randomBytes, randomUUID, createHash, createHmac, timingSafeEqual } from 'node:crypto';
import {
  CERTIFICATE_ID_ALPHABET,
  CERTIFICATE_ID_LENGTH,
  CERTIFICATE_ID_PREFIX,
} from '@campusconnect/shared';

/* -------------------------------------------------------------------------- */
/* Request ids                                                                */
/* -------------------------------------------------------------------------- */

/** Correlation id stamped on every request, log line, error body and audit row. */
export function newRequestId(): string {
  return randomUUID();
}

/* -------------------------------------------------------------------------- */
/* Slugs                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * URL-safe slug. Non-Latin scripts are transliterated poorly by a simple regex,
 * so we keep any Unicode letter/digit run intact and only collapse whitespace
 * and punctuation — a Devanagari event title therefore survives as a valid slug.
 */
export function slugify(input: string, maxLength = 80): string {
  const base = input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’"]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/g, '');

  return base.length > 0 ? base : `item-${randomBytes(3).toString('hex')}`;
}

/**
 * Slug that is unique within a scope. `exists` is supplied by the caller (usually
 * a Prisma count) so this stays free of database knowledge.
 */
export async function uniqueSlug(
  desired: string,
  exists: (candidate: string) => Promise<boolean>,
  maxAttempts = 12,
): Promise<string> {
  const base = slugify(desired);
  if (!(await exists(base))) return base;
  for (let i = 2; i <= maxAttempts; i += 1) {
    const candidate = `${base}-${i}`;
    if (!(await exists(candidate))) return candidate;
  }
  // Fall back to a random suffix rather than failing — an event must not be
  // unsaveable because twelve similarly-named ones already exist.
  return `${base}-${randomBytes(3).toString('hex')}`;
}

/**
 * Username for the public passport URL. Derived from the student's name and
 * uniquified across the platform (passport URLs are global, not per-college).
 */
export async function generateUsername(
  fullName: string,
  exists: (candidate: string) => Promise<boolean>,
): Promise<string> {
  const parts = fullName.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const first = slugify(parts[0] ?? 'student', 20);
  const last = parts.length > 1 ? slugify(parts[parts.length - 1]!, 20) : '';
  return uniqueSlug([first, last].filter(Boolean).join('-'), exists);
}

/* -------------------------------------------------------------------------- */
/* Certificate ids                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Public certificate id, e.g. `CC-2026-A7F3K2`.
 *
 * Crockford-style base32 (no I, L, O, U) so ids are unambiguous when read aloud
 * or typed from a printed certificate. 30^6 ≈ 729M combinations per year, which
 * is far beyond collision pressure at this scale — the caller still retries on
 * the unique-constraint violation as a belt-and-braces measure.
 */
export function generateCertificateId(issuedYear = new Date().getFullYear()): string {
  const bytes = randomBytes(CERTIFICATE_ID_LENGTH);
  let body = '';
  for (let i = 0; i < CERTIFICATE_ID_LENGTH; i += 1) {
    body += CERTIFICATE_ID_ALPHABET[bytes[i]! % CERTIFICATE_ID_ALPHABET.length];
  }
  return `${CERTIFICATE_ID_PREFIX}-${issuedYear}-${body}`;
}

/** Uppercase + strip separators, for tolerant lookup of a typed certificate id. */
export function normaliseCertificateId(input: string): string {
  const cleaned = input.trim().toUpperCase().replace(/[\s_]/g, '-');
  // Accept a bare body ("A7F3K2") or a full id with a missing year by leaving it
  // to the route validator to reject — this only normalises, it does not parse.
  return cleaned;
}

export function isValidCertificateIdFormat(input: string): boolean {
  return /^[A-Z]{2}-[0-9]{4}-[0-9A-Z]{4,10}$/.test(normaliseCertificateId(input));
}

/* -------------------------------------------------------------------------- */
/* Event pass codes                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Human-readable code printed beneath the QR on an event pass. Deliberately
 * short and grouped so a coordinator can read it aloud when a scanner fails:
 * `K7F3-92QD`. Not secret on its own — the manual check-in endpoint requires an
 * authenticated organiser and writes an audit row.
 */
export function generatePassCode(): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(8);
  let raw = '';
  for (let i = 0; i < 8; i += 1) raw += alphabet[bytes[i]! % alphabet.length];
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

/* -------------------------------------------------------------------------- */
/* Hashing & comparison                                                       */
/* -------------------------------------------------------------------------- */

export function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

export function hmacSha256(value: string, secret: string): string {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

/**
 * Constant-time string comparison. Both operands are hashed first so inputs of
 * differing length do not throw and do not leak length via timing.
 */
export function safeCompare(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

/** Opaque token for password reset / email verification links. */
export function generateOpaqueToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/* -------------------------------------------------------------------------- */
/* Display helpers                                                            */
/* -------------------------------------------------------------------------- */

export function initialsOf(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

/** `English, Hindi` style comma lists for CSV cells and audit summaries. */
export function joinNonEmpty(values: (string | null | undefined)[], separator = ', '): string {
  return values.filter((v): v is string => Boolean(v && v.trim())).join(separator);
}
