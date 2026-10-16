import { PrismaClient } from '@prisma/client';
import { env } from './env.js';

/**
 * A single PrismaClient per process.
 *
 * In development `tsx watch` reloads the module graph on every save, which
 * would otherwise open a new connection pool each time until Postgres refuses
 * connections. We cache the client on `globalThis` to survive reloads.
 */

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: env.isDevelopment ? ['warn', 'error'] : ['error'],
    errorFormat: env.isProduction ? 'minimal' : 'pretty',
  });

if (!env.isProduction) globalForPrisma.prisma = prisma;

/** Soft-delete aware default: models with `deletedAt` are filtered unless asked otherwise. */
export const notDeleted = { deletedAt: null } as const;

export async function connectDatabase(): Promise<void> {
  await prisma.$connect();
}

export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
}

/**
 * Health probe for `/api/v1/health`. Runs a trivial query rather than relying on
 * the connection state, because a pool can hold a socket to a database that has
 * since been restarted.
 */
export async function databaseHealth(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const started = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true, latencyMs: Date.now() - started };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      error: error instanceof Error ? error.message : 'unknown error',
    };
  }
}

export type { PrismaClient };
export * from '@prisma/client';
