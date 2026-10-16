import type { NextFunction, Request, Response } from 'express';
import { newRequestId } from '../utils/ids.js';
import { logger } from '../config/logger.js';

/**
 * Correlation id middleware.
 *
 * Accepts an inbound `X-Request-Id` (so a gateway or the web app's SSR fetcher
 * can supply one and correlate across services) but only when it looks like a
 * sane identifier — otherwise a client could inject a megabyte of text that ends
 * up in every log line for that request.
 *
 * Stamps the id on the response so a user reporting a bug can quote it, and
 * attaches a request-scoped logger to `req.log`.
 */

const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{8,128}$/;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId: string;
      log: ReturnType<typeof logger.withRequest>;
      /** Set by the auth middleware once a principal is resolved. */
      user?: import('@campusconnect/shared').AuthPrincipal;
    }
  }
}

export function requestContext(req: Request, res: Response, next: NextFunction): void {
  const inbound = req.headers['x-request-id'];
  const candidate = Array.isArray(inbound) ? inbound[0] : inbound;

  req.requestId =
    candidate && SAFE_REQUEST_ID.test(candidate) ? candidate : newRequestId();

  res.setHeader('X-Request-Id', req.requestId);
  req.log = logger.withRequest(req.requestId);

  next();
}

/**
 * Request/response timing. Logs at `warn` for slow requests so a performance
 * regression shows up in the log stream without a separate APM.
 */
const SLOW_REQUEST_MS = 1_000;

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const startedAt = process.hrtime.bigint();

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    const fields = {
      method: req.method,
      path: req.originalUrl.split('?')[0],
      status: res.statusCode,
      durationMs: Math.round(durationMs),
      userId: req.user?.id,
      // Never log the query string wholesale — it can carry emails and tokens.
    };

    const log = req.log ?? logger;
    if (res.statusCode >= 500) log.error('Request failed', undefined, fields);
    else if (durationMs > SLOW_REQUEST_MS) log.warn('Slow request', fields);
    else log.info('Request', fields);
  });

  next();
}
