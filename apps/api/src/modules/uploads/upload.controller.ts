import type { Request, Response } from 'express';
import { UPLOAD_RULES, type UploadPurpose } from '@campusconnect/shared';
import { validateUploadedFile } from '../../middleware/upload.js';
import {
  saveUpload,
  getFileUrl,
  getPublicFileBuffer,
  deleteFile,
} from '../../services/storage/index.js';
import { prisma } from '../../config/prisma.js';
import { requireUser } from '../../middleware/auth.js';
import { auditCreate, auditAction } from '../../utils/audit.js';
import { auditContextOf } from '../../utils/requestContext.js';
import { sha256 } from '../../utils/ids.js';
import { NotFoundError, UnsupportedMediaTypeError } from '../../utils/errors.js';
import { roleHasPermission } from '@campusconnect/shared';

/**
 * Upload controller.
 *
 * The two-step flow described in `middleware/upload.ts`: this endpoint stores the
 * bytes and returns a key; feature endpoints then reference that key. A feature
 * controller therefore never touches a file stream.
 */

export async function upload(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);

  const file = req.file;
  if (!file) throw new UnsupportedMediaTypeError('No file was received');

  const purpose = (req as Request & { uploadPurpose?: UploadPurpose }).uploadPurpose;
  if (!purpose) throw new UnsupportedMediaTypeError('An upload purpose is required');

  /*
   * Validate against the purpose's rules. This is where the declared MIME type is
   * checked against the file's actual magic bytes — see `validateUploadedFile`.
   */
  const { detectedMime } = validateUploadedFile(
    {
      buffer: file.buffer,
      mimetype: file.mimetype,
      size: file.size,
      originalname: file.originalname,
    },
    purpose,
  );

  const saved = await saveUpload({
    ownerId: user.id,
    collegeId: user.collegeId,
    purpose,
    buffer: file.buffer,
    detectedMime,
    originalName: file.originalname,
    // Stored so a later download can be checked against the record.
    checksum: sha256(file.buffer),
  });

  auditCreate(auditContextOf(req), 'FileAsset', saved.id, {
    purpose,
    size: saved.size,
    mimeType: saved.mimeType,
  });

  res.status(201).json({
    success: true,
    data: {
      id: saved.id,
      key: saved.key,
      url: saved.url,
      purpose: saved.purpose,
      mimeType: saved.mimeType,
      size: saved.size,
      originalName: saved.originalName,
      maxBytes: UPLOAD_RULES[purpose].maxBytes,
    },
  });
}

/**
 * Returns a time-limited URL for a stored object.
 *
 * Ownership is enforced by `getFileUrl`; a caller who may not read the object gets
 * a 404 rather than a 403, because "this exists but is not yours" is itself
 * information disclosure for a document like a resume.
 */
export async function getUrl(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { key } = req.params as { key: string };
  const query = req.query as { download?: string; expiresIn?: string };

  const url = await getFileUrl(
    decodeURIComponent(key),
    {
      userId: user.id,
      collegeId: user.collegeId,
      isPrivileged: roleHasPermission(user.role, 'analytics:read_college'),
    },
    {
      ...(query.download ? { downloadFilename: query.download } : {}),
      ...(query.expiresIn ? { expiresIn: Number(query.expiresIn) } : {}),
    },
  );

  if (!url) throw new NotFoundError('File');

  res.json({ success: true, data: { url } });
}

/**
 * Serves a public asset directly.
 *
 * Used for event banners and profile photos on public pages, which must render
 * without a signed URL. Only rows flagged `isPublic` are served — the check is on
 * the database row, never on the key prefix, so guessing a key gains nothing.
 */
export async function servePublic(req: Request, res: Response): Promise<void> {
  const { key } = req.params as { key: string };

  const file = await getPublicFileBuffer(decodeURIComponent(key));
  if (!file) throw new NotFoundError('File');

  /*
   * Content-Type comes from the validated database row, never the request, and
   * `X-Content-Type-Options: nosniff` stops a browser from second-guessing it. An
   * uploaded "image" that is really HTML would otherwise execute in the origin.
   */
  res.setHeader('Content-Type', file.mimeType);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; object-src 'none'");
  res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
  res.send(file.buffer);
}

export async function listMine(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const query = req.query as { purpose?: UploadPurpose; page?: number; pageSize?: number };

  const assets = await prisma.fileAsset.findMany({
    where: {
      ownerId: user.id,
      deletedAt: null,
      ...(query.purpose ? { purpose: query.purpose } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: Math.min(100, query.pageSize ?? 25),
    skip: ((query.page ?? 1) - 1) * (query.pageSize ?? 25),
    select: {
      id: true,
      key: true,
      url: true,
      purpose: true,
      mimeType: true,
      size: true,
      originalName: true,
      createdAt: true,
    },
  });

  res.json({ success: true, data: assets });
}

export async function remove(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { key } = req.params as { key: string };

  const deleted = await deleteFile(decodeURIComponent(key), user.id);
  if (!deleted) throw new NotFoundError('File');

  auditAction(auditContextOf(req), 'DELETE', 'FileAsset', null, { key: decodeURIComponent(key) });

  res.status(204).send();
}
