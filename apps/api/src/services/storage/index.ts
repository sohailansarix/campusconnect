import { prisma } from '../../config/prisma.js';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { buildStorageKey, extensionFor } from '../../middleware/upload.js';
import type { FilePurpose } from '@prisma/client';
import { LocalDiskStorage } from './localDisk.js';
import { S3Storage } from './s3.js';
import type { SignedUrlOptions, StorageAdapter } from './types.js';

/**
 * Storage facade.
 *
 * Everything above this layer deals in two concepts: a **key** (opaque, stable)
 * and a **FileAsset** row (ownership, purpose, validation results). The driver
 * underneath is an implementation detail chosen by `STORAGE_DRIVER`.
 *
 * The `FileAsset` table is the authority on who may read an object. A signed URL
 * is only ever minted after that check, which is what stops a leaked key from
 * being enough to fetch someone else's resume.
 */

let adapter: StorageAdapter | null = null;

/** Lazily constructed so importing this module has no side effects. */
export function getStorage(): StorageAdapter {
  if (adapter) return adapter;

  adapter = env.STORAGE_DRIVER === 's3' ? new S3Storage() : new LocalDiskStorage();
  logger.info('Storage adapter initialised', { driver: adapter.driver });

  return adapter;
}

/** Test seam — lets a suite inject an in-memory or temp-dir adapter. */
export function setStorage(next: StorageAdapter | null): void {
  adapter = next;
}

/** Call once at boot so the local root exists before the first upload. */
export async function initialiseStorage(): Promise<void> {
  const current = getStorage();
  if (current instanceof LocalDiskStorage) {
    await current.ensureRoot();
  }
  // The S3 adapter has nothing to set up: the bucket is provisioned out of band,
  // and creating it here would require permissions we deliberately do not grant
  // to the application role.
}

/* -------------------------------------------------------------------------- */
/* Upload                                                                     */
/* -------------------------------------------------------------------------- */

export type SaveUploadInput = {
  ownerId: string;
  collegeId: string | null;
  purpose: FilePurpose;
  /** Validated buffer from the upload middleware. */
  buffer: Buffer;
  /** Result of the magic-byte sniff — never the client's declared type. */
  detectedMime: string;
  originalName: string;
  /** Computed by the caller so the same value persists on the FileAsset row. */
  checksum?: string;
};

export type SavedUpload = {
  id: string;
  key: string;
  url: string;
  purpose: FilePurpose;
  mimeType: string;
  size: number;
  originalName: string;
};

/**
 * Persists a validated upload and records it.
 *
 * The object is written before the row: if the row insert fails, we are left with
 * an orphaned object (recoverable by a lifecycle rule) rather than a row pointing
 * at nothing (a broken image on every page that renders it).
 */
export async function saveUpload(input: SaveUploadInput): Promise<SavedUpload> {
  const storage = getStorage();
  const key = buildStorageKey(input.purpose, input.detectedMime);

  const stored = await storage.put({
    key,
    body: input.buffer,
    contentType: input.detectedMime,
    purpose: input.purpose,
    originalName: input.originalName,
    ownerId: input.ownerId,
    // Profile photos, banners and logos are rendered on public pages; resumes and
    // project files are not.
    isPublic: isPublicPurpose(input.purpose),
  });

  const asset = await prisma.fileAsset.create({
    data: {
      ownerId: input.ownerId,
      collegeId: input.collegeId,
      key,
      url: stored.url,
      driver: storage.driver === 's3' ? 'S3' : 'LOCAL',
      purpose: input.purpose,
      mimeType: input.detectedMime,
      detectedMimeType: input.detectedMime,
      size: stored.size,
      originalName: input.originalName,
      checksum: input.checksum,
      isPublic: isPublicPurpose(input.purpose),
    },
    select: { id: true },
  });

  return {
    id: asset.id,
    key,
    url: stored.url,
    purpose: input.purpose,
    mimeType: input.detectedMime,
    size: stored.size,
    originalName: input.originalName,
  };
}

/** Purposes whose objects are served on public pages without an auth check. */
const PUBLIC_PURPOSES: FilePurpose[] = [
  'PROFILE_PHOTO',
  'EVENT_BANNER',
  'CLUB_LOGO',
  'PROJECT_THUMBNAIL',
  'COMPANY_LOGO',
  'CERTIFICATE_PDF',
];

export function isPublicPurpose(purpose: FilePurpose): boolean {
  return PUBLIC_PURPOSES.includes(purpose);
}

/* -------------------------------------------------------------------------- */
/* Access                                                                     */
/* -------------------------------------------------------------------------- */

export type FileAccessContext = {
  userId: string;
  collegeId: string | null;
  /** True when the caller's role has a permission that overrides ownership. */
  isPrivileged: boolean;
};

/**
 * Resolves a URL for a stored object, checking ownership first.
 *
 * Returns null when the caller may not see it, so the caller can decide between a
 * 403 and a 404 — leaking "this exists but you cannot see it" is itself
 * information disclosure for a resume.
 */
export async function getFileUrl(
  key: string,
  context: FileAccessContext,
  options: SignedUrlOptions = {},
): Promise<string | null> {
  const asset = await prisma.fileAsset.findFirst({
    where: { key, deletedAt: null },
    select: { id: true, ownerId: true, collegeId: true, purpose: true, isPublic: true },
  });

  if (!asset) return null;

  const allowed =
    asset.isPublic ||
    asset.ownerId === context.userId ||
    context.isPrivileged ||
    (asset.collegeId !== null && asset.collegeId === context.collegeId && isCollegeVisible(asset.purpose));

  if (!allowed) return null;

  return getStorage().getUrl(key, options);
}

/**
 * Purposes a college administrator may view for their own students — placement
 * officers legitimately review resumes, but not a student's personal project
 * scratch files.
 */
const COLLEGE_VISIBLE_PURPOSES: FilePurpose[] = ['RESUME', 'CERTIFICATE_PDF', 'PROFILE_PHOTO'];

function isCollegeVisible(purpose: FilePurpose): boolean {
  return COLLEGE_VISIBLE_PURPOSES.includes(purpose);
}

/** Raw bytes, for server-side PDF embedding and image processing. */
export async function getFileBuffer(key: string): Promise<Buffer> {
  return getStorage().get(key);
}

/**
 * File bytes flagged as safe to serve from a public route.
 *
 * Used by the public certificate PDF and event banner routes, which are
 * unauthenticated by design. Only `isPublic` rows are served — the check is on
 * the database row, not on the key prefix, so an accidental key guess gains
 * nothing.
 */
export async function getPublicFileBuffer(
  key: string,
): Promise<{ buffer: Buffer; mimeType: string; originalName: string } | null> {
  const asset = await prisma.fileAsset.findFirst({
    where: { key, isPublic: true, deletedAt: null },
    select: { mimeType: true, originalName: true },
  });

  if (!asset) return null;

  const buffer = await getStorage().get(key);
  return { buffer, mimeType: asset.mimeType, originalName: asset.originalName };
}

/** Soft-deletes the row and removes the object. Used when a user deletes a file. */
export async function deleteFile(key: string, ownerId: string): Promise<boolean> {
  const asset = await prisma.fileAsset.findFirst({
    where: { key, ownerId, deletedAt: null },
    select: { id: true },
  });

  if (!asset) return false;

  await prisma.fileAsset.update({ where: { id: asset.id }, data: { deletedAt: new Date() } });
  // Object removal is best-effort: a row marked deleted is enough to hide it, and
  // a storage hiccup should not fail the user's action.
  await getStorage().delete(key).catch((error: unknown) => {
    logger.warn('Object deletion failed after the row was marked deleted', { key, error: String(error) });
  });

  return true;
}

/* -------------------------------------------------------------------------- */
/* Certificate PDFs                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Stores a generated certificate PDF and returns its key.
 *
 * Deterministic key (`certificates/<certificateId>.pdf`) rather than a random
 * one: re-issuing a certificate should replace the object at the same URL so
 * every previously emailed link keeps working.
 */
export async function storeCertificatePdf(
  certificateId: string,
  pdf: Buffer,
  ownerId: string,
  collegeId: string | null,
): Promise<{ key: string; url: string }> {
  const storage = getStorage();
  const key = `certificates/${certificateId}.pdf`;

  const stored = await storage.put({
    key,
    body: pdf,
    contentType: 'application/pdf',
    purpose: 'CERTIFICATE_PDF',
    ownerId,
    isPublic: true,
  });

  await prisma.fileAsset.upsert({
    where: { key },
    create: {
      key,
      url: stored.url,
      ownerId,
      collegeId,
      driver: storage.driver === 's3' ? 'S3' : 'LOCAL',
      purpose: 'CERTIFICATE_PDF',
      mimeType: 'application/pdf',
      detectedMimeType: 'application/pdf',
      size: stored.size,
      originalName: `${certificateId}.pdf`,
      isPublic: true,
    },
    // Re-issuing replaces the bytes; the row keeps its original owner.
    update: { url: stored.url, size: stored.size, deletedAt: null },
    select: { id: true },
  });

  return { key, url: stored.url };
}

/** Public URL for a certificate PDF, with no expiry — these are meant to be shared. */
export async function certificatePdfUrl(certificateId: string): Promise<string> {
  return getStorage().getUrl(`certificates/${certificateId}.pdf`, { expiresIn: 7 * 24 * 60 * 60 });
}

export { extensionFor };
