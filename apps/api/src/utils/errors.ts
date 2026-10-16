/**
 * Application error hierarchy.
 *
 * Every error the API returns is an `AppError` subclass, so the error middleware
 * has exactly one shape to serialise and the response contract in
 * `@campusconnect/shared` (`ApiErrorBody`) is guaranteed. Anything that is *not*
 * an AppError reaching the middleware is a bug and is reported as a 500 with the
 * stack logged but not returned.
 */

import type { ApiErrorCode } from '@campusconnect/shared';

export type ErrorDetail = { path: string; message: string };

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: ApiErrorCode;
  readonly details?: ErrorDetail[];
  /** Set false for expected, user-caused failures so monitoring does not page. */
  readonly isOperational: boolean;

  constructor(
    statusCode: number,
    code: ApiErrorCode,
    message: string,
    options: { details?: ErrorDetail[]; isOperational?: boolean; cause?: unknown } = {},
  ) {
    super(message);
    this.name = new.target.name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = options.details;
    this.isOperational = options.isOperational ?? true;
    if (options.cause !== undefined) this.cause = options.cause;
    Error.captureStackTrace?.(this, new.target);
  }

  toJSON(): { code: ApiErrorCode; message: string; details?: ErrorDetail[] } {
    return {
      code: this.code,
      message: this.message,
      ...(this.details && this.details.length > 0 ? { details: this.details } : {}),
    };
  }
}

/* -------------------------------------------------------------------------- */
/* 4xx                                                                        */
/* -------------------------------------------------------------------------- */

export class ValidationError extends AppError {
  constructor(message = 'The submitted data is invalid', details?: ErrorDetail[]) {
    super(422, 'VALIDATION_ERROR', message, { details });
  }
}

export class UnauthenticatedError extends AppError {
  constructor(message = 'Sign in to continue') {
    super(401, 'UNAUTHENTICATED', message);
  }
}

export class TokenExpiredError extends AppError {
  constructor(message = 'Your session has expired') {
    super(401, 'TOKEN_EXPIRED', message);
  }
}

export class TokenInvalidError extends AppError {
  constructor(message = 'That token is not valid') {
    super(401, 'TOKEN_INVALID', message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'You do not have access to this resource') {
    super(403, 'FORBIDDEN', message);
  }
}

export class NotFoundError extends AppError {
  constructor(resource = 'Resource') {
    super(404, 'NOT_FOUND', `${resource} not found`);
  }
}

export class ConflictError extends AppError {
  constructor(message = 'That record already exists') {
    super(409, 'CONFLICT', message);
  }
}

export class AlreadyRegisteredError extends AppError {
  constructor(message = 'You are already registered for this event') {
    super(409, 'ALREADY_REGISTERED', message);
  }
}

export class CapacityFullError extends AppError {
  constructor(message = 'This event is full') {
    super(409, 'CAPACITY_FULL', message);
  }
}

export class CertificateRevokedError extends AppError {
  constructor(message = 'This certificate has been revoked') {
    super(410, 'CERTIFICATE_REVOKED', message);
  }
}

export class RateLimitedError extends AppError {
  constructor(message = 'Too many requests — please slow down') {
    super(429, 'RATE_LIMITED', message);
  }
}

export class PayloadTooLargeError extends AppError {
  constructor(message = 'That file is too large') {
    super(413, 'PAYLOAD_TOO_LARGE', message);
  }
}

export class UnsupportedMediaTypeError extends AppError {
  constructor(message = 'That file type is not supported') {
    super(415, 'UNSUPPORTED_MEDIA_TYPE', message);
  }
}

export class InternalError extends AppError {
  constructor(message = 'Something went wrong on our end', cause?: unknown) {
    super(500, 'INTERNAL_ERROR', message, { isOperational: false, cause });
  }
}

/* -------------------------------------------------------------------------- */
/* Guards                                                                     */
/* -------------------------------------------------------------------------- */

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/** Assert a value is present, narrowing the type; throws NotFoundError otherwise. */
export function assertFound<T>(value: T | null | undefined, resource = 'Resource'): T {
  if (value === null || value === undefined) throw new NotFoundError(resource);
  return value;
}

/**
 * Ownership check used across modules: throws ForbiddenError when the caller
 * is neither the owner nor privileged. `isPrivileged` is computed by the caller
 * from the RBAC matrix so this helper stays free of policy.
 */
export function assertOwnerOrPrivileged(
  ownerId: string,
  callerId: string,
  isPrivileged: boolean,
  message = 'You can only modify your own records',
): void {
  if (ownerId !== callerId && !isPrivileged) throw new ForbiddenError(message);
}

/** Tenant guard: refuses cross-college access even for otherwise-authorised roles. */
export function assertSameCollege(
  resourceCollegeId: string | null | undefined,
  callerCollegeId: string | null | undefined,
): void {
  if (resourceCollegeId && callerCollegeId && resourceCollegeId !== callerCollegeId) {
    throw new ForbiddenError('That resource belongs to another institution');
  }
}
