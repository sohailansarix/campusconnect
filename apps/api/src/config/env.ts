/**
 * Environment loading and validation.
 *
 * The API is run from `apps/api` but the `.env` lives at the repo root (so the
 * web app can read the same file). We load the root file first, then let
 * `apps/api/.env` override it if a developer keeps a local copy.
 *
 * Validation is strict and eager: a missing secret should crash the process at
 * boot with a readable message, not surface as a 500 on the first login.
 */

import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

const here = path.dirname(fileURLToPath(import.meta.url));
/** apps/api/src/config → apps/api → repo root */
const apiRoot = path.resolve(here, '..', '..');
const repoRoot = path.resolve(apiRoot, '..', '..');

for (const candidate of [path.join(repoRoot, '.env'), path.join(apiRoot, '.env')]) {
  if (existsSync(candidate)) dotenv.config({ path: candidate, override: false });
}

const booleanish = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0', 'yes', 'no'])])
  .transform((v) => v === true || v === 'true' || v === '1' || v === 'yes');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  API_URL: z.string().url().default('http://localhost:4000'),
  WEB_URL: z.string().url().default('http://localhost:3000'),
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:3000')
    .transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean)),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('30d'),
  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(12),
  QR_TOKEN_SECRET: z.string().min(32).optional(),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(20),

  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  LOCAL_STORAGE_DIR: z.string().default('./uploads'),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default('ap-south-1'),
  S3_BUCKET: z.string().default('campusconnect-dev'),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: booleanish.default(true),
  MAX_UPLOAD_MB: z.coerce.number().int().positive().default(10),

  MAIL_DRIVER: z.enum(['console', 'smtp']).default('console'),
  MAIL_FROM: z.string().default('CampusConnect <no-reply@campusconnect.local>'),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().optional(),
  SMTP_SECURE: booleanish.default(false),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),

  PUSH_DRIVER: z.enum(['stub']).default('stub'),
  WHATSAPP_DRIVER: z.enum(['stub']).default('stub'),

  PAYMENT_DRIVER: z.enum(['stub', 'razorpay']).default('stub'),
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),

  AI_DRIVER: z.enum(['rule-based', 'llm']).default('rule-based'),
  ANTHROPIC_API_KEY: z.string().optional(),

  SENTRY_DSN: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  • ${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('\n');
  // Deliberately console.error + exit rather than throwing: the logger depends
  // on this module, so we cannot use it here.
  console.error(`\n✖ Invalid environment configuration:\n${issues}\n`);
  console.error('  Copy .env.example to .env and fill in the missing values.\n');
  process.exit(1);
}

export const env = {
  ...parsed.data,
  /** QR tokens fall back to the access secret so dev setups need one secret. */
  QR_TOKEN_SECRET: parsed.data.QR_TOKEN_SECRET ?? parsed.data.JWT_ACCESS_SECRET,
  isProduction: parsed.data.NODE_ENV === 'production',
  isDevelopment: parsed.data.NODE_ENV === 'development',
  isTest: parsed.data.NODE_ENV === 'test',
  apiRoot,
  repoRoot,
  /** Absolute path for the local storage adapter. */
  localStoragePath: path.isAbsolute(parsed.data.LOCAL_STORAGE_DIR)
    ? parsed.data.LOCAL_STORAGE_DIR
    : path.resolve(apiRoot, parsed.data.LOCAL_STORAGE_DIR),
} as const;

export type Env = typeof env;

/* -------------------------------------------------------------------------- */
/* Boot-time safety checks                                                    */
/* -------------------------------------------------------------------------- */

const INSECURE_MARKERS = ['change-me', 'dev-only', 'secret-change'];

function isPlaceholderSecret(value: string): boolean {
  return INSECURE_MARKERS.some((marker) => value.toLowerCase().includes(marker));
}

if (env.isProduction) {
  const problems: string[] = [];
  if (isPlaceholderSecret(env.JWT_ACCESS_SECRET)) problems.push('JWT_ACCESS_SECRET is a placeholder value');
  if (isPlaceholderSecret(env.JWT_REFRESH_SECRET)) problems.push('JWT_REFRESH_SECRET is a placeholder value');
  if (isPlaceholderSecret(env.QR_TOKEN_SECRET)) problems.push('QR_TOKEN_SECRET is a placeholder value');
  if (env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) {
    problems.push('JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must differ');
  }
  if (env.MAIL_DRIVER === 'console') problems.push('MAIL_DRIVER=console in production — emails will not be sent');
  if (env.STORAGE_DRIVER === 'local') {
    problems.push('STORAGE_DRIVER=local in production — uploads will not survive a redeploy');
  }

  if (problems.length > 0) {
    console.error('\n✖ Refusing to start in production:\n' + problems.map((p) => `  • ${p}`).join('\n') + '\n');
    process.exit(1);
  }
}
