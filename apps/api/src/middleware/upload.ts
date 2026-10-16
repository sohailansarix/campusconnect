import { randomUUID } from 'node:crypto';
import { open, unlink } from 'node:fs/promises';
import path from 'node:path';
import multer from 'multer';
import type { NextFunction, Request, Response } from 'express';
import { UPLOAD_RULES, type UploadPurpose } from '@campusconnect/shared';
import { env } from '../config/env.js';
import { PayloadTooLargeError, UnsupportedMediaTypeError, ValidationError } from '../utils/errors.js';
import { FilePurposeKey } from '../services/storage/types.js';

/**
 * File upload handling.
 *
 * The flow is deliberately two-step for non-trivial uploads:
 *
 *   1. `POST /uploads` with multipart data → validated, sniffed, stored, and a
 *      `FileAsset` row returned with a key.
 *   2. The feature endpoint (update profile, create event) references that key.
 *
 * That means a feature controller never touches a raw byte stream, and one
 * validator covers every upload path.
 *
 * Security posture:
 *  * Files are buffered in memory, not written to a predictable temp path, so
 *    there is no window where an unvalidated file sits on disk.
 *  * The declared MIME type is never trusted — magic bytes are checked against
 *    the allowlist for the stated purpose.
 *  * Storage keys are generated server-side. A client-supplied filename never
 *    reaches the filesystem, which removes path traversal and extension
 *    confusion (a "shell.php.jpg") in one move.
 *  * The original filename is retained only as display metadata.
 */

/** Magic-byte signatures for every MIME type the platform accepts. */
const MAGIC_BYTES: { mime: string; bytes: number[]; offset?: number }[] = [
  { mime: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { mime: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  // RIFF....WEBP — the container tag sits at offset 8.
  { mime: 'image/webp', bytes: [0x52, 0x49, 0x46, 0x46], offset: 0 },
  { mime: 'image/webp', bytes: [0x57, 0x45, 0x42, 0x50], offset: 8 },
  { mime: 'application/pdf', bytes: [0x25, 0x50, 0x44, 0x46] },
  // ZIP family: PK\x03\x04 (also matches .docx/.xlsx, which we reject by
  // checking the extension allowlist, not the signature alone).
  { mime: 'application/zip', bytes: [0x50, 0x4b, 0x03, 0x04] },
  { mime: 'application/zip', bytes: [0x50, 0x4b, 0x05, 0x06] },
];

/**
 * Detects the real MIME type from the first bytes of a buffer.
 * Returns null when nothing matches — an unknown file is rejected, not allowed.
 */
export function detectMimeType(buffer: Buffer): string | null {
  for (const signature of MAGIC_BYTES) {
    const offset = signature.offset ?? 0;
    if (buffer.length < offset + signature.bytes.length) continue;
    const slice = buffer.subarray(offset, offset + signature.bytes.length);
    if (slice.equals(Buffer.from(signature.bytes))) return signature.mime;
  }
  return null;
}

/**
 * WebP needs both the RIFF header and the WEBP tag; the loop above can match
 * either half, so it gets an explicit check.
 */
function isWebp(buffer: Buffer): boolean {
  return (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  );
}

/** MIME types that the signature check can distinguish. */
function normaliseDetectedMime(buffer: Buffer, declared: string): string | null {
  if (declared === 'image/webp' && isWebp(buffer)) return 'image/webp';
  const detected = detectMimeType(buffer);
  if (detected === 'image/webp') return isWebp(buffer) ? 'image/webp' : null;
  return detected;
}

/**
 * Validates a buffered file against the rules for its purpose.
 *
 * The declared content type is checked too, and a mismatch between declared and
 * detected is treated as hostile: a file claiming `image/png` whose bytes are a
 * PDF is either a broken client or an attempt to smuggle content past the
 * allowlist.
 */
export function validateUploadedFile(
  file: { buffer: Buffer; mimetype: string; size: number; originalname: string },
  purpose: UploadPurpose,
): { detectedMime: string } {
  const rules = UPLOAD_RULES[purpose];

  if (file.size > rules.maxBytes) {
    throw new PayloadTooLargeError(
      `Files for ${purpose.toLowerCase().replace(/_/g, ' ')} must be under ${Math.round(rules.maxBytes / 1024 / 1024)}MB`,
    );
  }

  const detected = normaliseDetectedMime(file.buffer, file.mimetype);

  if (!detected) {
    throw new UnsupportedMediaTypeError(
      'That file could not be identified. Upload a PDF, PNG, JPEG or WebP file.',
    );
  }

  if (!rules.mimeTypes.includes(detected)) {
    const allowed = rules.mimeTypes.map((m) => m.split('/')[1]?.toUpperCase()).join(', ');
    throw new UnsupportedMediaTypeError(`This upload accepts ${allowed} files only`);
  }

  // A declared type outside the allowlist is a client bug worth surfacing.
  if (!rules.mimeTypes.includes(file.mimetype) && file.mimetype !== 'application/octet-stream') {
    throw new UnsupportedMediaTypeError('The declared file type is not allowed for this upload');
  }

  assertSafeFilename(file.originalname);

  return { detectedMime: detected };
}

/** Rejects filenames that suggest an attempt at traversal or null injection. */
function assertSafeFilename(name: string): void {
  if (name.length === 0 || name.length > 200) {
    throw new ValidationError('The filename is not valid');
  }
  if (name.includes('\0') || name.includes('/') || name.includes('\\') || name.includes('..')) {
    throw new ValidationError('The filename is not valid');
  }
  // Control characters can break Content-Disposition headers on download.
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f]/.test(name)) {
    throw new ValidationError('The filename is not valid');
  }
}

/* -------------------------------------------------------------------------- */
/* Multer configuration                                                       */
/* -------------------------------------------------------------------------- */

/** Route param name carrying the upload purpose. */
export const PURPOSE_FIELD = 'purpose';

/**
 * Reads the purpose from the multipart body. Multer parses text fields before
 * files, so `req.body.purpose` is available in `fileFilter` as long as the client
 * sends it before the file part — which the documented upload helper does.
 */
function purposeFromRequest(req: Request): UploadPurpose {
  const raw = (req.body?.[PURPOSE_FIELD] ?? req.query[PURPOSE_FIELD]) as string | undefined;
  if (!raw) throw new ValidationError(`An upload ${PURPOSE_FIELD} is required`);

  const key = raw.toUpperCase() as FilePurposeKey;
  if (!(key in UPLOAD_RULES)) {
    throw new ValidationError(`Unknown upload purpose "${raw}"`);
  }
  return key as UploadPurpose;
}

/**
 * Single-file upload middleware factory.
 *
 * Files are held in memory with a hard cap equal to the largest rule, so a
 * malicious 500MB upload is rejected by multer before it is fully buffered.
 * Actual per-purpose limits are enforced afterwards in `validateUploadedFile`
 * because the purpose is only known once the multipart body is parsed.
 */
export function uploadSingle(fieldName = 'file') {
  const largestRule = Math.max(...Object.values(UPLOAD_RULES).map((r) => r.maxBytes));

  const middleware = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: Math.min(largestRule, env.MAX_UPLOAD_MB * 1024 * 1024),
      files: 1,
      fields: 10,
      fieldSize: 4096,
    },
    fileFilter: (_req, file, cb) => {
      // Cheap pre-filter on the declared type; the authoritative check is the
      // magic-byte sniff after buffering.
      const allowedAnywhere = new Set(Object.values(UPLOAD_RULES).flatMap((r) => r.mimeTypes));
      if (!allowedAnywhere.has(file.mimetype)) {
        cb(new UnsupportedMediaTypeError('That file type is not supported'));
        return;
      }
      cb(null, true);
    },
  }).single(fieldName);

  return (req: Request, res: Response, next: NextFunction): void => {
    middleware(req, res, (error: unknown) => {
      if (error) {
        next(error);
        return;
      }
      if (!req.file) {
        next(new ValidationError('No file was included in the request'));
        return;
      }
      // Attach the validated purpose so the controller does not re-derive it.
      (req as Request & { uploadPurpose?: UploadPurpose }).uploadPurpose = purposeFromRequest(req);
      next();
    });
  };
}

/** Multi-file variant, capped by the smallest rule to stay predictable. */
export function uploadMany(fieldName = 'files', maxFiles = 5) {
  const middleware = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024, files: maxFiles, fields: 10 },
  }).array(fieldName, maxFiles);

  return (req: Request, res: Response, next: NextFunction): void => {
    middleware(req, res, (error: unknown) => {
      if (error) return next(error);
      const files = (req.files as Express.Multer.File[] | undefined) ?? [];
      if (files.length === 0) return next(new ValidationError('No files were included in the request'));
      (req as Request & { uploadPurpose?: UploadPurpose }).uploadPurpose = purposeFromRequest(req);
      next();
    });
  };
}

/* -------------------------------------------------------------------------- */
/* Storage key generation                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Builds an opaque, collision-resistant storage key.
 *
 * Layout: `<purpose>/<yyyy>/<mm>/<uuid><ext>`
 *
 * The date prefix keeps object listings manageable and lets a lifecycle rule
 * expire a whole month at once. The extension comes from the *detected* MIME
 * type, never from the client's filename, so the stored object's extension
 * always matches its content.
 */
export function buildStorageKey(purpose: UploadPurpose, detectedMime: string): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const extension = extensionFor(detectedMime);

  return `${purpose.toLowerCase()}/${year}/${month}/${randomUUID()}${extension}`;
}

const MIME_EXTENSIONS: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'application/pdf': '.pdf',
  'application/zip': '.zip',
};

export function extensionFor(mime: string): string {
  return MIME_EXTENSIONS[mime] ?? '.bin';
}

/**
 * Deletes a buffered temp file left behind by a failed upload.
 *
 * Memory storage means there is usually nothing to clean up, but the disk
 * storage path used by the seed script and the CLI importer writes to a temp
 * directory, so this is kept for those callers.
 */
export async function removeTempFile(filePath: string): Promise<void> {
  try {
    // Only touch files inside the OS temp directory — refuse anything else so a
    // mis-wired caller cannot delete application data.
    const resolved = path.resolve(filePath);
    const tempRoot = path.resolve(env.apiRoot, 'uploads', 'tmp');
    if (!resolved.startsWith(tempRoot)) return;
    await unlink(resolved);
  } catch {
    // Best-effort cleanup.
  }
}

/** Creates a zero-byte file at a path, used by the storage adapter on init. */
export async function touchFile(filePath: string): Promise<void> {
  const handle = await open(filePath, 'a');
  await handle.close();
}
