/**
 * Storage adapter contract.
 *
 * Two implementations ship today:
 *   - `LocalDiskStorage` — development default, writes under `apps/api/uploads`.
 *   - `S3Storage`        — production, any S3-compatible endpoint (AWS, MinIO,
 *                          Cloudflare R2, DigitalOcean Spaces).
 *
 * The interface is deliberately small. Everything a caller needs is
 * `put`/`get`/`getUrl`/`delete` plus a signed-URL method, so swapping providers is
 * a one-file change behind `getStorage()`.
 *
 * Callers never see a filesystem path or a bucket — they hold a *key* and ask the
 * adapter for a URL. That is what makes the same code work on disk in dev and S3
 * in production.
 */

import type { FilePurpose } from '@prisma/client';

/** Alias for the Prisma enum, re-exported so services do not import Prisma types. */
export type FilePurposeKey = FilePurpose;

export type PutObjectInput = {
  /** Storage key from `buildStorageKey()`. Never a client-supplied path. */
  key: string;
  body: Buffer;
  contentType: string;
  /** Set for objects intended to be served without authentication. */
  isPublic?: boolean;
  /** Retained as object metadata for support and debugging. */
  originalName?: string;
  /** Owner id, recorded as object metadata so orphaned objects can be traced. */
  ownerId?: string;
  /** Purpose, recorded as metadata. */
  purpose?: FilePurposeKey;
};

export type StoredObject = {
  key: string;
  url: string;
  size: number;
  contentType: string;
  /** Provider-specific ETag/checksum when available. */
  etag?: string;
};

export type SignedUrlOptions = {
  /** Seconds until the URL expires. Capped by each adapter. */
  expiresIn?: number;
  /** Forces a download with this filename rather than inline display. */
  downloadFilename?: string;
};

export interface StorageAdapter {
  readonly driver: 'local' | 's3';

  /** Writes an object, overwriting any existing object at the same key. */
  put(input: PutObjectInput): Promise<StoredObject>;

  /** Reads an object. Throws if the key does not exist. */
  get(key: string): Promise<Buffer>;

  /** Cheap existence check, used to decide whether a PDF must be regenerated. */
  exists(key: string): Promise<boolean>;

  /** Deletes an object. Deleting a missing key is not an error. */
  delete(key: string): Promise<void>;

  /**
   * A URL the browser can fetch.
   *
   * For public objects this is a stable CDN/static URL. For private objects it is
   * a time-limited signed URL — which is why the method is async and takes an
   * expiry rather than being a pure getter.
   */
  getUrl(key: string, options?: SignedUrlOptions): Promise<string>;

  /**
   * Absolute filesystem path, when the driver has one.
   *
   * PDFKit and Sharp both need a real path or a stream, not a URL. S3 returns
   * null here and callers must use `get()` instead.
   */
  getLocalPath(key: string): string | null;
}

/** Raised when a key does not exist, so callers can distinguish 404 from failure. */
export class StorageObjectNotFoundError extends Error {
  constructor(key: string) {
    super(`No stored object at key "${key}"`);
    this.name = 'StorageObjectNotFoundError';
  }
}

/** Length of time private-object URLs stay valid. */
export const DEFAULT_SIGNED_URL_TTL_SECONDS = 15 * 60;

/** Maximum a caller may request, regardless of what they pass. */
export const MAX_SIGNED_URL_TTL_SECONDS = 7 * 24 * 60 * 60;
