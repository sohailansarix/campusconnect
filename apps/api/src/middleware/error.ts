import type { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import type { ApiErrorBody, ApiErrorCode } from '@campusconnect/shared';
import { AppError, ValidationError } from '../utils/errors.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

/**
 * Terminal error handler.
 *
 * Converts anything thrown in the app into the single error envelope defined in
 * `@campusconnect/shared`. Registered last in `app.ts`.
 *
 * The rule this enforces: **a client never sees an internal message they could
 * act on maliciously, and never sees a stack**. Prisma's constraint errors are
 * mapped to friendly messages because they are the most common way a controller
 * leaks database internals ("Unique constraint failed on the fields: (email)" is
 * fine, but the raw error also carries table and column names).
 */

/** Maps a Prisma error code to a status, code and message. */
function fromPrismaError(error: Prisma.PrismaClientKnownRequestError): {
  status: number;
  code: ApiErrorCode;
  message: string;
} {
  const target = (error.meta?.target as string[] | string | undefined) ?? undefined;
  const field = Array.isArray(target) ? target.join(', ') : target;

  switch (error.code) {
    case 'P2002': {
      const friendly = field?.includes('email')
        ? 'An account with that email already exists'
        : field?.includes('username')
          ? 'That username is taken'
          : field?.includes('passCode')
            ? 'A pass code collision occurred — please retry'
            : field?.includes('certificateId')
              ? 'A certificate id collision occurred — please retry'
              : `That ${field ?? 'value'} is already in use`;
      return { status: 409, code: 'CONFLICT', message: friendly };
    }
    case 'P2003':
      return { status: 409, code: 'CONFLICT', message: 'That record is still referenced elsewhere' };
    case 'P2025':
      return { status: 404, code: 'NOT_FOUND', message: 'That record no longer exists' };
    case 'P2014':
      return { status: 409, code: 'CONFLICT', message: 'This change would break a required relationship' };
    case 'P2034':
      // Serialisation failure under concurrent writes — safe for the client to retry.
      return { status: 409, code: 'CONFLICT', message: 'That change conflicted with another update — please retry' };
    default:
      return { status: 500, code: 'INTERNAL_ERROR', message: 'A database error occurred' };
  }
}

function fromMulterError(error: Error & { code?: string }): { status: number; code: ApiErrorCode; message: string } | null {
  switch (error.code) {
    case 'LIMIT_FILE_SIZE':
      return { status: 413, code: 'PAYLOAD_TOO_LARGE', message: `Files must be under ${env.MAX_UPLOAD_MB}MB` };
    case 'LIMIT_FILE_COUNT':
      return { status: 413, code: 'PAYLOAD_TOO_LARGE', message: 'Too many files in one upload' };
    case 'LIMIT_UNEXPECTED_FILE':
      return { status: 422, code: 'VALIDATION_ERROR', message: 'Unexpected file field in the upload' };
    default:
      return null;
  }
}

export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  // Express requires a 4-arity signature to recognise this as an error handler,
  // and if headers are already sent the only correct move is to delegate to the
  // default handler, which destroys the socket.
  if (res.headersSent) return next(error);

  const log = req.log ?? logger.withRequest(req.requestId ?? 'unknown');
  const requestId = req.requestId;

  let status = 500;
  let code: ApiErrorCode = 'INTERNAL_ERROR';
  let message = 'Something went wrong on our end';
  let details: { path: string; message: string }[] | undefined;
  /** Expected, user-caused failures are logged at `warn`, not `error`. */
  let isOperational = false;

  if (error instanceof AppError) {
    ({ status, code, message } = { status: error.statusCode, code: error.code, message: error.message });
    details = error.details;
    isOperational = error.isOperational;
  } else if (error instanceof Prisma.PrismaClientKnownRequestError) {
    ({ status, code, message } = fromPrismaError(error));
    isOperational = status < 500;
  } else if (error instanceof Prisma.PrismaClientValidationError) {
    // A malformed query means a bug in our service layer, not bad user input.
    status = 500;
    code = 'INTERNAL_ERROR';
    message = 'The request could not be processed';
  } else if (error instanceof Prisma.PrismaClientInitializationError) {
    status = 503;
    code = 'INTERNAL_ERROR';
    message = 'The service is temporarily unavailable — please retry shortly';
    isOperational = true;
  } else if (error instanceof Error && fromMulterError(error)) {
    const mapped = fromMulterError(error)!;
    ({ status, code, message } = mapped);
    isOperational = true;
  } else if (error instanceof SyntaxError && 'body' in error) {
    // express.json() failed to parse the payload.
    status = 400;
    code = 'VALIDATION_ERROR';
    message = 'The request body is not valid JSON';
    isOperational = true;
  } else if (error instanceof ValidationError) {
    status = error.statusCode;
    code = error.code;
    message = error.message;
    details = error.details;
    isOperational = true;
  }

  const fields = {
    status,
    code,
    method: req.method,
    path: req.originalUrl.split('?')[0],
    userId: req.user?.id,
    // The Prisma code is safe and genuinely useful in logs (P2002 vs P2025).
    prismaCode: error instanceof Prisma.PrismaClientKnownRequestError ? error.code : undefined,
  };

  if (isOperational) {
    log.warn(message, fields);
  } else {
    log.error('Unhandled error', error, fields);
    reportToMonitoring(error, { requestId, ...fields });
  }

  const body: ApiErrorBody = {
    success: false,
    error: {
      code,
      // A non-operational 500 always gets the generic message, even if the
      // underlying Error had a descriptive one — it could name a table or file.
      message: isOperational ? message : 'Something went wrong on our end',
      ...(details && details.length > 0 ? { details } : {}),
      ...(requestId ? { requestId } : {}),
    },
  };

  res.status(status).json(body);
}

/**
 * Error monitoring hook.
 *
 * A no-op unless `SENTRY_DSN` (or an equivalent DSN) is configured. The call
 * site is deliberately a seam: swapping in Sentry, OpenTelemetry or a webhook
 * means implementing this one function, not touching the handler.
 *
 * TODO(Phase 4): wire the real SDK behind `MONITORING_DRIVER`.
 */
function reportToMonitoring(error: unknown, context: Record<string, unknown>): void {
  if (!env.SENTRY_DSN) return;
  // Kept as structured logging until an SDK is wired in, so the data is at least
  // captured rather than dropped.
  logger.error('monitoring:report', error, context);
}

/* -------------------------------------------------------------------------- */
/* 404                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Catch-all for unmatched routes. Mounted after every router so an unknown path
 * returns the same error envelope as everything else rather than Express's HTML
 * default.
 */
export function notFoundHandler(req: Request, res: Response): void {
  const body: ApiErrorBody = {
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: `No route matches ${req.method} ${req.originalUrl.split('?')[0]}`,
      ...(req.requestId ? { requestId: req.requestId } : {}),
    },
  };
  res.status(404).json(body);
}

/**
 * Wraps an async handler so a rejected promise reaches `errorHandler`.
 *
 * Express 4 does not await handlers, so without this every async route needs its
 * own try/catch. Wrapping at the router level (see `modules/index.ts`) keeps the
 * controllers free of boilerplate.
 */
export function asyncHandler<T extends (req: Request, res: Response, next: NextFunction) => Promise<unknown>>(
  handler: T,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    void handler(req, res, next).catch(next);
  };
}
