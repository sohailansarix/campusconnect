/**
 * JWT issuing and verification.
 *
 * Two token types with separate secrets, so a leaked access secret cannot mint
 * refresh tokens (and vice versa):
 *
 *   access  — short-lived (15m), carries the principal, verified per request.
 *   refresh — long-lived (30d), stored *hashed* in the Session table so it can be
 *             rotated and revoked. A refresh token that is not in the database is
 *             rejected even if its signature is valid.
 *
 * Both carry `tokenVersion`, which is compared against `User.tokenVersion` so a
 * password change or "log out everywhere" invalidates every outstanding token
 * without needing a denylist.
 */

import jwt, { type JwtPayload, type SignOptions } from 'jsonwebtoken';
import type { AuthPrincipal, Role } from '@campusconnect/shared';
import { env } from '../config/env.js';
import { TokenExpiredError, TokenInvalidError } from './errors.js';

export type TokenType = 'access' | 'refresh';

export type AccessTokenClaims = {
  sub: string;
  typ: 'access';
  email: string;
  role: Role;
  fullName: string;
  collegeId: string | null;
  departmentId: string | null;
  employerId: string | null;
  tokenVersion: number;
};

export type RefreshTokenClaims = {
  sub: string;
  typ: 'refresh';
  tokenVersion: number;
  /** Session row id — lets us validate the specific session, not just the user. */
  sid: string;
};

const ISSUER = 'campusconnect';
const AUDIENCE = 'campusconnect-api';

function secretFor(type: TokenType): string {
  return type === 'access' ? env.JWT_ACCESS_SECRET : env.JWT_REFRESH_SECRET;
}

function ttlFor(type: TokenType): string {
  return type === 'access' ? env.JWT_ACCESS_TTL : env.JWT_REFRESH_TTL;
}

/** Seconds, for the `expiresIn` field in the login response. */
export function ttlSeconds(type: TokenType): number {
  return parseDurationToSeconds(ttlFor(type));
}

export function parseDurationToSeconds(duration: string): number {
  const match = /^(\d+)\s*(s|m|h|d|w)$/.exec(duration.trim());
  if (!match) {
    const asNumber = Number(duration);
    if (Number.isFinite(asNumber)) return asNumber;
    throw new TokenInvalidError(`Unsupported duration format: ${duration}`);
  }
  const value = Number(match[1]);
  const unit = match[2] as 's' | 'm' | 'h' | 'd' | 'w';
  const multipliers = { s: 1, m: 60, h: 3600, d: 86400, w: 604800 } as const;
  return value * multipliers[unit];
}

/** Absolute expiry date for a refresh token — stored on the Session row. */
export function refreshExpiryDate(rememberMe = false): Date {
  // "Remember me" doubles the session lifetime instead of using a separate TTL
  // config, which keeps the number of env knobs down.
  const seconds = ttlSeconds('refresh') * (rememberMe ? 2 : 1);
  return new Date(Date.now() + seconds * 1000);
}

export function signAccessToken(principal: AuthPrincipal, tokenVersion: number): string {
  const claims: Omit<AccessTokenClaims, 'sub'> & { sub: string } = {
    sub: principal.id,
    typ: 'access',
    email: principal.email,
    role: principal.role,
    fullName: principal.fullName,
    collegeId: principal.collegeId,
    departmentId: principal.departmentId,
    employerId: principal.employerId ?? null,
    tokenVersion,
  };
  return jwt.sign(claims, secretFor('access'), {
    expiresIn: ttlFor('access'),
    issuer: ISSUER,
    audience: AUDIENCE,
  } as SignOptions);
}

export function signRefreshToken(userId: string, sessionId: string, tokenVersion: number): string {
  const claims: Omit<RefreshTokenClaims, 'sub'> & { sub: string } = {
    sub: userId,
    typ: 'refresh',
    sid: sessionId,
    tokenVersion,
  };
  return jwt.sign(claims, secretFor('refresh'), {
    expiresIn: ttlFor('refresh'),
    issuer: ISSUER,
    audience: AUDIENCE,
  } as SignOptions);
}

export function verifyAccessToken(token: string): AccessTokenClaims {
  return verify<AccessTokenClaims>(token, 'access');
}

export function verifyRefreshToken(token: string): RefreshTokenClaims {
  return verify<RefreshTokenClaims>(token, 'refresh');
}

function verify<T extends JwtPayload>(token: string, type: TokenType): T {
  try {
    const decoded = jwt.verify(token, secretFor(type), {
      issuer: ISSUER,
      audience: AUDIENCE,
      // Reject a refresh token presented as an access token, and vice versa.
      algorithms: ['HS256'],
    });

    if (typeof decoded === 'string') throw new TokenInvalidError();
    if (decoded.typ !== type) {
      throw new TokenInvalidError(`Expected a ${type} token`);
    }
    return decoded as T;
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw new TokenExpiredError(
        type === 'access' ? 'Your session has expired — refresh and retry' : 'Your session has expired, please sign in again',
      );
    }
    if (error instanceof TokenInvalidError) throw error;
    throw new TokenInvalidError();
  }
}

/** Rebuild the request principal from verified access claims. */
export function claimsToPrincipal(claims: AccessTokenClaims): AuthPrincipal {
  return {
    id: claims.sub,
    email: claims.email,
    role: claims.role,
    fullName: claims.fullName,
    collegeId: claims.collegeId ?? null,
    departmentId: claims.departmentId ?? null,
    employerId: claims.employerId ?? null,
  };
}

/**
 * Extracts a bearer token from the Authorization header, falling back to a
 * cookie for the web app's SSR fetches. Returns null when neither is present so
 * the caller can distinguish "no credentials" from "bad credentials".
 */
export function extractBearerToken(
  headers: Record<string, string | string[] | undefined>,
): string | null {
  const raw = headers.authorization;
  const header = Array.isArray(raw) ? raw[0] : raw;
  if (header?.startsWith('Bearer ')) {
    const token = header.slice(7).trim();
    if (token.length > 0) return token;
  }
  return null;
}
