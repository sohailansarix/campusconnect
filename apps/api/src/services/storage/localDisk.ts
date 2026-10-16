import { createReadStream } from 'node:fs';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import {
  DEFAULT_SIGNED_URL_TTL_SECONDS,
  MAX_SIGNED_URL_TTL_SECONDS,
  StorageObjectNotFoundError,
  type PutObjectInput,
  type SignedUrlOptions,
  type StorageAdapter,
  type StoredObject,
} from './types.js';

/**
 * Local-disk storage adapter — the development default.
 *
 * Objects live under `apps/api/uploads` and are served by the API itself at
 * `/uploads/<key>` (mounted in `app.ts`). Two consequences worth knowing:
 *
 *  * Uploads do not survive a container redeploy, because the filesystem is
 *    ephemeral. Production boot refuses `STORAGE_DRIVER=local` for that reason
 *    (see `config/env.ts`).
 *  * "Signed" URLs are not actually cryptographically signed here. The adapter
 *    still honours the expiry in the returned URL so the *shape* of the response
 *    matches S3 and no calling code has to branch. The dev-only static route
 *    ignores the signature because there is no secret worth protecting in a
 *    local development environment.
 */
export class LocalDiskStorage implements StorageAdapter {
  readonly driver = 'local' as const;

  private readonly root: string;
  private readonly publicPrefix: string;

  constructor(options: { root?: string; publicPrefix?: string } = {}) {
    this.root = options.root ?? env.localStoragePath;
    // Served by the static handler mounted in app.ts.
    this.publicPrefix = options.publicPrefix ?? '/uploads';
  }

  /**
   * Resolves a key to an absolute path, refusing anything that escapes the root.
   *
   * Keys are generated server-side (`buildStorageKey`), so traversal should be
   * impossible — but this adapter is also reachable from the seed script and the
   * CLI importer, and a defensive resolve is far cheaper than an incident.
   */
  private resolveKey(key: string): string {
    const normalised = key.replace(/^\/+/, '').replace(/\\/g, '/');
    if (normalised.includes('..')) {
      throw new Error(`Refusing to resolve storage key outside the root: ${key}`);
    }
    const resolved = path.resolve(this.root, normalised);
    if (!resolved.startsWith(path.resolve(this.root))) {
      throw new Error(`Refusing to resolve storage key outside the root: ${key}`);
    }
    return resolved;
  }

  private absoluteUrl(pathname: string): string {
    // The API base URL already includes the host; the web app rewrites /uploads
    // through its own origin in production behind a reverse proxy.
    return `${env.API_URL}${pathname}`;
  }

  async put(input: PutObjectInput): Promise<StoredObject> {
    const filePath = this.resolveKey(input.key);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, input.body);

    logger.debug('Stored object on local disk', {
      key: input.key,
      size: input.body.byteLength,
      purpose: input.purpose,
    });

    return {
      key: input.key,
      url: await this.getUrl(input.key, { expiresIn: DEFAULT_SIGNED_URL_TTL_SECONDS }),
      size: input.body.byteLength,
      contentType: input.contentType,
      etag: undefined,
    };
  }

  async get(key: string): Promise<Buffer> {
    const filePath = this.resolveKey(key);
    try {
      return await readFile(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new StorageObjectNotFoundError(key);
      }
      throw error;
    }
  }

  /** Streaming read for large objects — avoids buffering a 15MB zip in memory. */
  createReadStream(key: string): NodeJS.ReadableStream {
    return createReadStream(this.resolveKey(key));
  }

  async exists(key: string): Promise<boolean> {
    try {
      const stats = await stat(this.resolveKey(key));
      return stats.isFile();
    } catch {
      return false;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await rm(this.resolveKey(key), { force: true });
    } catch (error) {
      // `force: true` already suppresses ENOENT; anything else is a real problem.
      logger.warn('Failed to delete local object', { key, error: String(error) });
    }
  }

  async getUrl(key: string, options: SignedUrlOptions = {}): Promise<string> {
    const ttl = Math.min(options.expiresIn ?? DEFAULT_SIGNED_URL_TTL_SECONDS, MAX_SIGNED_URL_TTL_SECONDS);
    const url = new URL(`${this.publicPrefix}/${key.replace(/^\/+/, '')}`, env.API_URL);

    // Mirrors the S3 adapter's query parameters so callers and tests see one
    // shape. The dev static handler validates only the expiry.
    url.searchParams.set('exp', String(Math.floor(Date.now() / 1000) + ttl));
    if (options.downloadFilename) {
      url.searchParams.set('download', options.downloadFilename);
    }
    return url.toString();
  }

  getLocalPath(key: string): string | null {
    return this.resolveKey(key);
  }

  /** Ensures the upload root exists. Called once at boot. */
  async ensureRoot(): Promise<void> {
    await mkdir(this.root, { recursive: true });
  }

  /** Used by the static handler to decide whether a request is in-window. */
  static isExpired(exp: string | undefined): boolean {
    if (!exp) return false; // No expiry supplied — dev convenience.
    const parsed = Number(exp);
    if (!Number.isFinite(parsed)) return true;
    return parsed * 1000 < Date.now();
  }

  /** Absolute URL for a public object, without the signing query string. */
  publicUrl(key: string): string {
    return this.absoluteUrl(`${this.publicPrefix}/${key.replace(/^\/+/, '')}`);
  }
}

/** Convenience singleton for the seed script and other standalone entry points. */
export function createLocalDiskStorage(): LocalDiskStorage {
  return new LocalDiskStorage();
}
