import { z } from 'zod';
import { listQuerySchema } from './common.js';

/**
 * File uploads.
 *
 * The client declares a purpose so the API can apply the right size limit, MIME
 * allowlist and storage path. The API never trusts the client's content-type —
 * see `validateUploadedFile` in `apps/api/src/middleware/upload.ts`, which sniffs
 * magic bytes.
 */
export const UPLOAD_PURPOSES = [
  'PROFILE_PHOTO',
  'EVENT_BANNER',
  'CLUB_LOGO',
  'CERTIFICATE_BACKGROUND',
  'CERTIFICATE_PDF',
  'RESUME',
  'PROJECT_FILE',
  'PROJECT_THUMBNAIL',
  'COMPANY_LOGO',
] as const;
export type UploadPurpose = (typeof UPLOAD_PURPOSES)[number];

export const UPLOAD_RULES: Record<UploadPurpose, { maxBytes: number; mimeTypes: string[]; public: boolean }> = {
  PROFILE_PHOTO: { maxBytes: 2 * 1024 * 1024, mimeTypes: ['image/jpeg', 'image/png', 'image/webp'], public: true },
  EVENT_BANNER: { maxBytes: 5 * 1024 * 1024, mimeTypes: ['image/jpeg', 'image/png', 'image/webp'], public: true },
  CLUB_LOGO: { maxBytes: 2 * 1024 * 1024, mimeTypes: ['image/jpeg', 'image/png', 'image/webp'], public: true },
  CERTIFICATE_BACKGROUND: {
    maxBytes: 8 * 1024 * 1024,
    mimeTypes: ['image/jpeg', 'image/png', 'application/pdf'],
    public: false,
  },
  CERTIFICATE_PDF: { maxBytes: 8 * 1024 * 1024, mimeTypes: ['application/pdf'], public: true },
  RESUME: { maxBytes: 5 * 1024 * 1024, mimeTypes: ['application/pdf'], public: false },
  PROJECT_FILE: {
    maxBytes: 15 * 1024 * 1024,
    mimeTypes: ['application/pdf', 'image/jpeg', 'image/png', 'application/zip'],
    public: false,
  },
  PROJECT_THUMBNAIL: { maxBytes: 3 * 1024 * 1024, mimeTypes: ['image/jpeg', 'image/png', 'image/webp'], public: true },
  COMPANY_LOGO: { maxBytes: 2 * 1024 * 1024, mimeTypes: ['image/jpeg', 'image/png', 'image/webp'], public: true },
};

export const requestUploadSchema = z.object({
  purpose: z.enum(UPLOAD_PURPOSES),
  filename: z.string().trim().min(1).max(200),
  contentType: z.string().trim().max(120),
  size: z.coerce.number().int().positive(),
});
export type RequestUploadInput = z.infer<typeof requestUploadSchema>;

export const uploadListQuerySchema = listQuerySchema.extend({
  purpose: z.enum(UPLOAD_PURPOSES).optional(),
  ownerId: z.string().cuid().optional(),
});

export const fileAssetSchema = z.object({
  id: z.string(),
  key: z.string(),
  url: z.string(),
  purpose: z.enum(UPLOAD_PURPOSES),
  mimeType: z.string(),
  size: z.number().int(),
  originalName: z.string(),
  createdAt: z.coerce.date(),
});
export type FileAssetDto = z.infer<typeof fileAssetSchema>;
