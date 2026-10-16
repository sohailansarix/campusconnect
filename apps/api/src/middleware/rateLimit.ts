import rateLimit, { type Options } from 'express-rate-limit';
import type { Request, Response } from 'express';
import type { ApiErrorBody } from '@campusconnect/shared';
import { env } from '../config/env.js';

/**
 * Rate limiting.
 *
 * The default store is in-memory, which is correct for the pilot's single API
 * instance and wrong the moment there are two — limits would be per-instance and
 * therefore roughly doubled. TODO(Phase 4): swap in a Redis store
 * (`rate-limit-redis`) behind `REDIS_URL` before scaling horizontally. The
 * factory below is the single place that needs to change.
 */

/** Consistent 429 body, matching the API error envelope. */
function rateLimitHandler(req: Request, res: Response): void {
  const body: ApiErrorBody = {
    success: false,
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many requests — please slow down and try again shortly',
      ...(req.requestId ? { requestId: req.requestId } : {}),
    },
  };
  res.status(429).json(body);
}

/** Limits are disabled under test, where suites fire hundreds of requests. */
function skipInTest(): boolean {
  return env.isTest;
}

const shared: Partial<Options> = {
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: rateLimitHandler,
  skip: skipInTest,
  // Never key on a spoofable header alone — `req.ip` respects the configured
  // `trust proxy` setting, which app.ts sets from the environment.
  keyGenerator: (req) => req.user?.id ?? req.ip ?? 'unknown',
};

/** Global limiter — applied to the whole API surface. */
export const globalLimiter = rateLimit({
  ...shared,
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: env.RATE_LIMIT_MAX,
  // Authenticated users get a larger budget: a dashboard loading six widgets is
  // six requests, and a shared campus NAT would otherwise exhaust the pool.
  keyGenerator: (req) => req.user?.id ?? req.ip ?? 'unknown',
});

/**
 * Strict limiter for credential endpoints (login, register, password reset).
 * Keyed on IP *and* the submitted email so a single attacker cannot spray many
 * accounts from one address, and one account cannot be brute-forced from many.
 */
export const authLimiter = rateLimit({
  ...shared,
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: env.AUTH_RATE_LIMIT_MAX,
  keyGenerator: (req) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.toLowerCase().slice(0, 160) : '';
    return `${req.ip ?? 'unknown'}:${email}`;
  },
  // A successful login should not count against the budget, so a user who
  // mistypes twice is not locked out after a genuine success.
  skipSuccessfulRequests: true,
});

/** Password reset: much tighter, and never skipped on success. */
export const passwordResetLimiter = rateLimit({
  ...shared,
  windowMs: 60 * 60 * 1000,
  limit: 5,
  keyGenerator: (req) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.toLowerCase().slice(0, 160) : '';
    return `reset:${req.ip ?? 'unknown'}:${email}`;
  },
});

/**
 * Refresh-token limiter. A client refreshing in a tight loop is either buggy or
 * replaying stolen tokens; either way it should be cut off quickly.
 */
export const refreshLimiter = rateLimit({
  ...shared,
  windowMs: 15 * 60 * 1000,
  limit: 60,
});

/** Writes that fan out to many rows or send many emails. */
export const bulkOperationLimiter = rateLimit({
  ...shared,
  windowMs: 60 * 60 * 1000,
  limit: 20,
  keyGenerator: (req) => req.user?.id ?? req.ip ?? 'unknown',
});

/**
 * Attendance scanning. A busy registration desk scans a few hundred passes in an
 * hour, so this is deliberately generous — it exists to stop a runaway scanner
 * client, not to throttle legitimate use.
 */
export const scanLimiter = rateLimit({
  ...shared,
  windowMs: 60 * 1000,
  limit: 300,
  keyGenerator: (req) => req.user?.id ?? req.ip ?? 'unknown',
});

/**
 * Public, unauthenticated and relatively expensive endpoints (certificate
 * verification, public passport) — keyed by IP.
 */
export const publicReadLimiter = rateLimit({
  ...shared,
  windowMs: 15 * 60 * 1000,
  limit: 120,
  keyGenerator: (req) => `public:${req.ip ?? 'unknown'}`,
});

/** CSV exports — each one runs an aggregate query across a college's data. */
export const exportLimiter = rateLimit({
  ...shared,
  windowMs: 60 * 60 * 1000,
  limit: 30,
  keyGenerator: (req) => `export:${req.user?.id ?? req.ip ?? 'unknown'}`,
});

/** File uploads. */
export const uploadLimiter = rateLimit({
  ...shared,
  windowMs: 60 * 60 * 1000,
  limit: 100,
  keyGenerator: (req) => req.user?.id ?? req.ip ?? 'unknown',
});
