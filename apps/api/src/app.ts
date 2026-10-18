import express, { type Express, type Request } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import { env } from './config/env.js';
import { apiRouter } from './modules/index.js';
import { requestContext, requestLogger } from './middleware/requestContext.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { globalLimiter } from './middleware/rateLimit.js';
import { requireJsonContentType } from './middleware/validate.js';
import { logger } from './config/logger.js';
import { mountDocs } from './config/swagger.js';

/**
 * Vercel routes the public web app and API through the same origin. Treat a
 * request whose Origin matches the forwarded public host as same-origin before
 * applying the cross-origin allowlist.
 */
function isSameOriginRequest(req: Request, origin: string): boolean {
  try {
    const parsedOrigin = new URL(origin);
    const host =
      req.get('x-forwarded-host')?.split(',')[0]?.trim() ?? req.get('host');
    const protocol =
      req.get('x-forwarded-proto')?.split(',')[0]?.trim() ?? req.protocol;

    if (!host) return false;

    return (
      parsedOrigin.host.toLowerCase() === host.toLowerCase() &&
      parsedOrigin.protocol === `${protocol}:`
    );
  } catch {
    return false;
  }
}

/**
 * Express application assembly.
 *
 * Middleware order here is load-bearing. Reading top to bottom:
 *
 *   1. `trust proxy`     — so `req.ip` is the real client behind a load balancer.
 *                          Wrong, and the rate limiter throttles the proxy instead
 *                          of the attacker.
 *   2. `helmet`          — security headers, including a strict CSP.
 *   3. `cors`            — allowlist only; never a wildcard with credentials.
 *   4. `compression`     — but not for the CSV exports, which are already streamed.
 *   5. body parsing      — with a hard size limit.
 *   6. request context   — correlation id, then the request logger that uses it.
 *   7. rate limiting     — global, before any route work happens.
 *   8. routes
 *   9. 404, then the error handler last.
 */

export function createApp(): Express {
  const app = express();

  /**
   * Trust exactly one proxy hop in production. `true` would trust any
   * `X-Forwarded-For`, letting a client spoof its own IP and bypass the limiter.
   */
  app.set('trust proxy', env.isProduction ? 1 : false);
  app.disable('x-powered-by');

  /* ---------------------------------------------------------------------- */
  /* Security headers                                                       */
  /* ---------------------------------------------------------------------- */

  app.use(
    helmet({
      // The API returns JSON, with one exception: the upload route serves images.
      // A restrictive CSP there still allows image rendering.
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'none'"],
          imgSrc: ["'self'", 'data:'],
          // Swagger UI needs inline styles and scripts; it is mounted separately
          // and only in non-production (see `mountDocs`).
          ...(env.isProduction
            ? {}
            : {
                scriptSrc: ["'self'", "'unsafe-inline'"],
                styleSrc: ["'self'", "'unsafe-inline'"],
                connectSrc: ["'self'"],
              }),
        },
      },
      // The API may be consumed through the shared app origin or a separate
      // origin, so CORP must not be same-origin.
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      crossOriginEmbedderPolicy: false,
      referrerPolicy: { policy: 'no-referrer' },
      hsts: env.isProduction ? { maxAge: 31_536_000, includeSubDomains: true, preload: true } : false,
    }),
  );

  /* ---------------------------------------------------------------------- */
  /* CORS                                                                   */
  /* ---------------------------------------------------------------------- */

  const corsMiddleware = cors({
    origin(origin, callback) {
      // Requests without Origin are server-to-server or do not need CORS.
      if (!origin) return callback(null, true);

      if (env.CORS_ORIGINS.includes(origin)) return callback(null, true);

      // A local network address in development, so testing on a phone against a
      // laptop's LAN IP works without editing .env.
      if (env.isDevelopment && /^https?:\/\/(\d{1,3}\.){3}\d{1,3}(:\d+)?$/.test(origin)) {
        return callback(null, true);
      }

      logger.warn('Blocked cross-origin request', { origin });
      return callback(new Error('Not allowed by CORS'));
    },
    // Required for the httpOnly refresh cookie to be sent by the web app.
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
    // So the client can read the correlation id off a response.
    exposedHeaders: ['X-Request-Id'],
    maxAge: 86_400,
  });

  app.use((req, res, next) => {
    const origin = req.get('origin');
    if (origin && isSameOriginRequest(req, origin)) return next();
    return corsMiddleware(req, res, next);
  });

  /* ---------------------------------------------------------------------- */
  /* Parsing                                                                */
  /* ---------------------------------------------------------------------- */

  app.use(
    compression({
      // CSV responses set their own Content-Disposition and are streamed; double
      // compression wastes CPU for no gain.
      filter: (req, res) => {
        if (req.path.includes('/export')) return false;
        return compression.filter(req, res);
      },
    }),
  );

  /**
   * A 1MB JSON limit. The largest legitimate body is a bulk certificate request
   * with a few hundred student ids; anything larger is a mistake or an attack.
   */
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));
  app.use(cookieParser());

  app.use(requireJsonContentType);

  /* ---------------------------------------------------------------------- */
  /* Observability                                                          */
  /* ---------------------------------------------------------------------- */

  app.use(requestContext);
  app.use(requestLogger);

  if (!env.isTest) {
    // Morgan is kept for the human-readable access line in development; the
    // structured logger above is what production aggregation reads.
    app.use(
      morgan(env.isDevelopment ? 'dev' : 'combined', {
        skip: (req) => req.path === '/api/v1/health',
      }),
    );
  }

  /* ---------------------------------------------------------------------- */
  /* Rate limiting                                                          */
  /* ---------------------------------------------------------------------- */

  app.use('/api', globalLimiter);

  /* ---------------------------------------------------------------------- */
  /* Docs & static                                                          */
  /* ---------------------------------------------------------------------- */

  mountDocs(app);

  /**
   * Local-disk storage in development. Mounted only when the local driver is
   * active — in production the objects are served from S3 or a CDN, and this route
   * would be a path to files the bucket policy already protects better.
   */
  if (env.STORAGE_DRIVER === 'local') {
    app.use(
      '/uploads',
      express.static(env.localStoragePath, {
        // `immutable` because keys are content-addressed by uuid — the same key
        // never changes content.
        maxAge: '1d',
        index: false,
        dotfiles: 'deny',
        setHeaders(res) {
          res.setHeader('X-Content-Type-Options', 'nosniff');
        },
      }),
    );
  }

  /* ---------------------------------------------------------------------- */
  /* Routes                                                                 */
  /* ---------------------------------------------------------------------- */

  app.use('/api/v1', apiRouter);

  // A bare root response so hitting the host directly is not a confusing 404.
  app.get('/', (_req, res) => {
    res.json({
      success: true,
      data: {
        name: 'CampusConnect API',
        tagline: 'From Campus Experience to Career Readiness',
        version: '1.0.0',
        api: '/api/v1',
        health: '/api/v1/health',
        docs: env.isProduction ? null : '/api/docs',
      },
    });
  });

  /* ---------------------------------------------------------------------- */
  /* Terminal handlers — order matters: 404 then error                       */
  /* ---------------------------------------------------------------------- */

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
