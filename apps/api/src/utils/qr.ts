/**
 * Event pass QR tokens.
 *
 * The QR on a student's pass encodes a *signed payload*, not a registration id.
 * Two reasons this matters:
 *
 *  1. Integrity — a registration id in a QR is guessable/enumerable, so anyone
 *     could forge a pass for someone else's registration. A signature makes the
 *     payload unforgeable without the server secret.
 *  2. Replay scope — the signature covers the event id, so a pass for event A
 *     cannot be scanned at event B even if both belong to the same student.
 *
 * Format: `CC1.<base64url(payload)>.<base64url(hmac)>`
 * The version prefix exists so the format can change without invalidating every
 * previously downloaded pass in one deploy.
 */

import { z } from 'zod';
import { env } from '../config/env.js';
import { hmacSha256, safeCompare, sha256 } from './ids.js';
import { TokenInvalidError } from './errors.js';

export const PASS_TOKEN_VERSION = 'CC1';

const passTokenPayloadSchema = z.object({
  /** Registration id — what the scanner resolves. */
  r: z.string().min(1),
  /** Event id — binds the pass to exactly one event. */
  e: z.string().min(1),
  /** Issued-at, epoch seconds. */
  iat: z.number().int(),
  /** Expires-at, epoch seconds. Defaults to the event's end + grace period. */
  exp: z.number().int(),
});

export type PassTokenPayload = z.infer<typeof passTokenPayloadSchema>;

/** Grace window after an event ends during which a scan is still accepted. */
const DEFAULT_GRACE_SECONDS = 6 * 60 * 60;

export type SignPassTokenInput = {
  registrationId: string;
  eventId: string;
  /** Event end time; the token expires this plus the grace window. */
  eventEndsAt: Date;
  graceSeconds?: number;
};

export function signPassToken(input: SignPassTokenInput): string {
  const now = Math.floor(Date.now() / 1000);
  const exp =
    Math.floor(input.eventEndsAt.getTime() / 1000) + (input.graceSeconds ?? DEFAULT_GRACE_SECONDS);

  const payload: PassTokenPayload = {
    r: input.registrationId,
    e: input.eventId,
    iat: now,
    exp,
  };

  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = hmacSha256(`${PASS_TOKEN_VERSION}.${body}`, env.QR_TOKEN_SECRET);
  return `${PASS_TOKEN_VERSION}.${body}.${signature}`;
}

/**
 * Verifies a scanned token. Throws `TokenInvalidError` with a message that is
 * safe to show a coordinator at the door ("this pass is for a different event",
 * "this pass has expired") rather than a generic failure — the person scanning
 * needs to know whether to send the student to the help desk.
 */
export function verifyPassToken(token: string): PassTokenPayload {
  const parts = token.trim().split('.');
  if (parts.length !== 3) throw new TokenInvalidError('This is not a CampusConnect pass');

  const [version, body, signature] = parts as [string, string, string];
  if (version !== PASS_TOKEN_VERSION) {
    throw new TokenInvalidError('This pass was issued by an older version of the app');
  }

  const expected = hmacSha256(`${version}.${body}`, env.QR_TOKEN_SECRET);
  if (!safeCompare(signature, expected)) {
    throw new TokenInvalidError('This pass failed its integrity check');
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    throw new TokenInvalidError('This pass could not be read');
  }

  const parsed = passTokenPayloadSchema.safeParse(decoded);
  if (!parsed.success) throw new TokenInvalidError('This pass is malformed');

  const now = Math.floor(Date.now() / 1000);
  if (parsed.data.exp < now) {
    throw new TokenInvalidError('This pass has expired');
  }

  return parsed.data;
}

/** Assert the scanned pass belongs to the event currently being scanned. */
export function assertPassMatchesEvent(tokenEventId: string, scannedEventId: string): void {
  if (tokenEventId !== scannedEventId) {
    throw new TokenInvalidError('This pass is for a different event');
  }
}

/** Stored on the attendance row so a disputed scan can be traced to its payload. */
export function passTokenFingerprint(token: string): string {
  return sha256(token);
}

/* -------------------------------------------------------------------------- */
/* QR image generation                                                        */
/* -------------------------------------------------------------------------- */

export type QrOptions = {
  /** Rendered pixel width. 512 is comfortable for a phone screenshot at 3x. */
  width?: number;
  margin?: number;
  darkColor?: string;
  lightColor?: string;
};

/**
 * Renders a QR code as a PNG data URL.
 *
 * Error-correction level M is the default; `qrcode` picks the version
 * automatically. We keep the loader dynamic so the ~50KB dependency is only
 * pulled in by the pass endpoints rather than on every cold start.
 */
export async function generateQrDataUrl(content: string, options: QrOptions = {}): Promise<string> {
  const { default: QRCode } = await import('qrcode');
  return QRCode.toDataURL(content, {
    errorCorrectionLevel: 'M',
    type: 'image/png',
    width: options.width ?? 512,
    margin: options.margin ?? 2,
    color: {
      dark: options.darkColor ?? '#0F172A',
      light: options.lightColor ?? '#FFFFFF',
    },
  });
}

/** Raw PNG buffer, for embedding in a PDF rather than the web page. */
export async function generateQrPngBuffer(content: string, options: QrOptions = {}): Promise<Buffer> {
  const { default: QRCode } = await import('qrcode');
  return QRCode.toBuffer(content, {
    errorCorrectionLevel: 'M',
    type: 'png',
    width: options.width ?? 512,
    margin: options.margin ?? 2,
  });
}

/** The text encoded in the pass QR — the full signed token plus a readable label. */
export function buildPassQrContent(token: string, passCode: string): string {
  // Keeping a human-readable prefix means a scanner app that merely displays the
  // raw string still shows something meaningful to an organiser.
  return `${env.WEB_URL}/pass/${passCode}?t=${encodeURIComponent(token)}`;
}

/** Extract the token back out of a scanned URL, or accept a bare token. */
export function extractTokenFromScan(scanned: string): string {
  const trimmed = scanned.trim();
  if (trimmed.startsWith(PASS_TOKEN_VERSION + '.')) return trimmed;

  const urlMatch = /[?&]t=([^&]+)/.exec(trimmed);
  if (urlMatch?.[1]) return decodeURIComponent(urlMatch[1]);

  return trimmed;
}
