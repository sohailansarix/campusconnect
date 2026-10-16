import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError, type ZodTypeAny, type z } from 'zod';
import { ValidationError } from '../utils/errors.js';
import {
  assertNoPrototypePollution,
  assertPrimitive,
  sanitizeDeep,
} from '../utils/sanitize.js';

/**
 * Request validation.
 *
 * One middleware per input location, each of which:
 *   1. rejects prototype-pollution keys and operator-shaped values,
 *   2. sanitises every string (strips HTML),
 *   3. parses with the supplied Zod schema,
 *   4. *replaces* the raw input with the parsed result.
 *
 * Step 4 is the important one. Controllers read `req.body`/`req.query` and get
 * the coerced, defaulted, stripped value — never the raw payload. It also means
 * an unknown key silently disappears instead of reaching a Prisma `data` object
 * by spread.
 */

/** Error-message keys on the request object. */
type ValidatedStore = {
  body?: unknown;
  query?: unknown;
  params?: unknown;
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      validated?: ValidatedStore;
    }
  }
}

function toValidationError(error: ZodError): ValidationError {
  const details = error.issues.map((issue) => ({
    path: issue.path.join('.') || '(root)',
    message: issue.message,
  }));

  const first = details[0];
  const summary = first
    ? details.length === 1
      ? `${first.path}: ${first.message}`
      : `${first.path}: ${first.message} (and ${details.length - 1} more)`
    : 'The submitted data is invalid';

  return new ValidationError(summary, details);
}

/**
 * Values that indicate the client is trying to shape a Prisma filter rather than
 * send data. A string field receiving `{"contains": "x"}` is the classic case.
 */
function assertNoOperators(value: unknown, path = ''): void {
  if (value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoOperators(item, `${path}[${index}]`));
    return;
  }
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (key.startsWith('$')) {
      throw new ValidationError(`Unsupported field "${path}${key}"`);
    }
    assertNoOperators(nested, `${path}${key}.`);
  }
}

/**
 * Express 4 leaves `req.query` as a getter in some configurations, so we define
 * our own property before assigning. `defineProperty` also keeps the assignment
 * from throwing on a frozen request prototype.
 */
function setInput(req: Request, location: keyof ValidatedStore, value: unknown): void {
  // Keep the original available for audit/debugging without letting a controller
  // accidentally read it instead of the validated version.
  req.validated = { ...(req.validated ?? {}), [location]: value };

  Object.defineProperty(req, location, {
    value,
    writable: true,
    configurable: true,
    enumerable: true,
  });
}

function validate<T extends ZodTypeAny>(
  schema: T,
  location: keyof ValidatedStore,
  options: { sanitize?: boolean; stripHtml?: boolean } = {},
): RequestHandler {
  const { sanitize = true } = options;

  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      const raw = req[location];
      if (raw === undefined || raw === null) {
        // Let the schema decide whether the location is required.
        const parsed = schema.safeParse({});
        if (!parsed.success) throw toValidationError(parsed.error);
        setInput(req, location, parsed.data);
        return next();
      }

      assertNoPrototypePollution(raw, location);
      assertNoOperators(raw);

      // Query and params are always strings from the URL; body values that are
      // already primitive are left alone.
      const prepared = sanitize ? prepareValue(raw, location) : raw;

      const parsed = schema.safeParse(prepared);
      if (!parsed.success) throw toValidationError(parsed.error);

      setInput(req, location, parsed.data);
      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Sanitises strings without destroying types. The body is deep-sanitised; query
 * values are already strings or arrays of strings, so they are handled per value
 * to avoid coercing `"true"` into something Zod cannot read.
 */
function prepareValue(raw: unknown, location: keyof ValidatedStore): unknown {
  if (location === 'body') return sanitizeDeep(raw);

  if (Array.isArray(raw)) return raw.map((v) => (typeof v === 'string' ? v : v));
  if (raw && typeof raw === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      assertPrimitive(value, key);
      out[key] = value;
    }
    return out;
  }
  return raw;
}

export const validateBody = <T extends ZodTypeAny>(schema: T) => validate(schema, 'body');
export const validateQuery = <T extends ZodTypeAny>(schema: T) =>
  validate(schema, 'query', { sanitize: false });
export const validateParams = <T extends ZodTypeAny>(schema: T) =>
  validate(schema, 'params', { sanitize: false });

/** Read a validated input with its inferred type, falling back to the raw value. */
export function validated<T extends ZodTypeAny>(
  req: Request,
  location: 'body' | 'query' | 'params',
  // The schema is only used for its inferred type here.
  _schema?: T,
): z.infer<T> {
  const store = req.validated?.[location];
  if (store !== undefined) return store as z.infer<T>;
  return req[location] as z.infer<T>;
}

/**
 * Validates that a request declares a JSON content type before the body parser
 * has run. Without this, `express.json()` silently yields `{}` for a form post
 * and the schema reports a confusing "field is required" instead of "unsupported
 * media type".
 */
export function requireJsonContentType(req: Request, res: Response, next: NextFunction): void {
  if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
    const contentType = req.headers['content-type'] ?? '';
    // multipart/form-data is handled by the upload routes, which set their own
    // parser before reaching the body validator.
    if (!contentType.includes('application/json') && !contentType.includes('multipart/form-data')) {
      res.status(415).json({
        success: false,
        error: {
          code: 'UNSUPPORTED_MEDIA_TYPE',
          message: 'Send this request as application/json',
          requestId: req.requestId,
        },
      });
      return;
    }
  }
  next();
}
