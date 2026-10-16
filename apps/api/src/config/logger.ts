/**
 * Structured logging without a third-party dependency at this scale.
 *
 * Development gets human-readable colourised lines; production emits one JSON
 * object per line so a log aggregator can index the fields. `requestId` is the
 * join key between an HTTP request, its audit rows and any error report.
 */

import { env } from './env.js';

type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const MIN_LEVEL: Level = env.isDevelopment ? 'debug' : 'info';

const COLOURS: Record<Level, string> = {
  debug: '\x1b[90m',
  info: '\x1b[36m',
  warn: '\x1b[33m',
  error: '\x1b[31m',
};
const RESET = '\x1b[0m';

/** Keys whose values are never written to logs, at any nesting depth. */
const REDACTED_KEYS = new Set([
  'password',
  'passwordHash',
  'currentPassword',
  'newPassword',
  'confirmPassword',
  'token',
  'accessToken',
  'refreshToken',
  'refreshTokenHash',
  'authorization',
  'cookie',
  'secret',
  'apiKey',
  'ANTHROPIC_API_KEY',
  'RAZORPAY_KEY_SECRET',
]);

function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[deep]';
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));

  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    out[key] = REDACTED_KEYS.has(key) ? '[redacted]' : redact(val, depth + 1);
  }
  return out;
}

function errorToFields(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      errorName: error.name,
      errorMessage: error.message,
      // Stack traces are useful in dev and noisy in production aggregators, but
      // dropping them entirely makes production incidents much harder to debug.
      ...(env.isDevelopment ? { stack: error.stack } : { stack: error.stack?.split('\n').slice(0, 4).join('\n') }),
    };
  }
  return { errorMessage: String(error) };
}

function emit(level: Level, message: string, fields: Record<string, unknown> = {}): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[MIN_LEVEL]) return;

  const payload = redact(fields) as Record<string, unknown>;
  const timestamp = new Date().toISOString();

  if (env.isProduction) {
    const line = JSON.stringify({ timestamp, level, message, ...payload });
    if (level === 'error') process.stderr.write(line + '\n');
    else process.stdout.write(line + '\n');
    return;
  }

  const tag = `${COLOURS[level]}${level.toUpperCase().padEnd(5)}${RESET}`;
  const time = timestamp.slice(11, 23);
  const context = Object.keys(payload).length > 0 ? ' ' + JSON.stringify(payload) : '';
  const stream = level === 'error' ? process.stderr : process.stdout;
  stream.write(`${time} ${tag} ${message}${context}\n`);
}

export const logger = {
  debug: (message: string, fields?: Record<string, unknown>) => emit('debug', message, fields),
  info: (message: string, fields?: Record<string, unknown>) => emit('info', message, fields),
  warn: (message: string, fields?: Record<string, unknown>) => emit('warn', message, fields),
  error: (message: string, error?: unknown, fields?: Record<string, unknown>) =>
    emit('error', message, { ...fields, ...(error ? errorToFields(error) : {}) }),

  /** Request-scoped logger that stamps every line with the correlation id. */
  withRequest(requestId: string, userId?: string) {
    const base = { requestId, ...(userId ? { userId } : {}) };
    return {
      debug: (m: string, f?: Record<string, unknown>) => emit('debug', m, { ...base, ...f }),
      info: (m: string, f?: Record<string, unknown>) => emit('info', m, { ...base, ...f }),
      warn: (m: string, f?: Record<string, unknown>) => emit('warn', m, { ...base, ...f }),
      error: (m: string, e?: unknown, f?: Record<string, unknown>) =>
        emit('error', m, { ...base, ...f, ...(e ? errorToFields(e) : {}) }),
    };
  },
};

export type Logger = typeof logger;
export type RequestLogger = ReturnType<typeof logger.withRequest>;
