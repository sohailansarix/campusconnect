import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
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
 * S3-compatible storage adapter.
 *
 * Works against AWS S3, MinIO, Cloudflare R2 and DigitalOcean Spaces. The
 * differences between them are absorbed by two settings:
 *
 *  * `forcePathStyle` — MinIO and most self-hosted endpoints need path-style
 *    addressing (`endpoint/bucket/key`); AWS prefers virtual-host style.
 *  * A custom `endpoint` — omitted for AWS, set for everything else.
 *
 * Bucket policy assumption: the bucket is private. Public assets (event banners,
 * profile photos) are still served through this adapter, but via long-lived
 * signed URLs cached at the edge. Making the bucket public-read would be faster
 * and is the better choice at scale; it is not the default because one
 * misconfigured key prefix would then expose resumes and certificates.
 * TODO(Phase 4): add a `public/` key prefix with a public-read bucket policy and
 * route `isPublic: true` objects there.
 */
export class S3Storage implements StorageAdapter {
  readonly driver = 's3' as const;

  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly endpoint?: string;

  constructor(options: {
    bucket?: string;
    region?: string;
    endpoint?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
    forcePathStyle?: boolean;
  } = {}) {
    this.bucket = options.bucket ?? env.S3_BUCKET;
    this.endpoint = options.endpoint ?? env.S3_ENDPOINT ?? undefined;

    this.client = new S3Client({
      region: options.region ?? env.S3_REGION,
      ...(this.endpoint ? { endpoint: this.endpoint } : {}),
      forcePathStyle: options.forcePathStyle ?? env.S3_FORCE_PATH_STYLE,
      credentials:
        options.accessKeyId && options.secretAccessKey
          ? { accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey }
          : // Fall through to the default provider chain (instance role, env,
            // shared config file) when explicit keys are not configured.
            undefined,
    });
  }

  async put(input: PutObjectInput): Promise<StoredObject> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: input.key,
      Body: input.body,
      ContentType: input.contentType,
      // Server-side encryption at rest. Harmless on MinIO, meaningful on AWS.
      ServerSideEncryption: 'AES256',
      Metadata: {
        ...(input.originalName ? { originalname: sanitiseMetadata(input.originalName) } : {}),
        ...(input.ownerId ? { ownerid: input.ownerId } : {}),
        ...(input.purpose ? { purpose: input.purpose } : {}),
      },
    });

    const response = await this.client.send(command);

    logger.debug('Stored object in S3', { key: input.key, size: input.body.byteLength, bucket: this.bucket });

    return {
      key: input.key,
      url: await this.getUrl(input.key, { expiresIn: DEFAULT_SIGNED_URL_TTL_SECONDS }),
      size: input.body.byteLength,
      contentType: input.contentType,
      etag: response.ETag,
    };
  }

  async get(key: string): Promise<Buffer> {
    try {
      const response = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );

      if (!response.Body) throw new StorageObjectNotFoundError(key);

      // The SDK returns a `SdkStream` in Node; `transformToByteArray` is the
      // supported way to read it without leaking a stream.
      const bytes = await (response.Body as { transformToByteArray: () => Promise<Uint8Array> })
        .transformToByteArray();
      return Buffer.from(bytes);
    } catch (error) {
      if (isNotFound(error)) throw new StorageObjectNotFoundError(key);
      throw error;
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch (error) {
      if (isNotFound(error)) return false;
      // A permission or network error is not "absent" — surface it so the caller
      // does not regenerate a PDF that already exists.
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    } catch (error) {
      // S3 returns 204 for a missing key too, so any error here is real.
      logger.warn('Failed to delete S3 object', { key, error: String(error) });
    }
  }

  async getUrl(key: string, options: SignedUrlOptions = {}): Promise<string> {
    const expiresIn = Math.min(options.expiresIn ?? DEFAULT_SIGNED_URL_TTL_SECONDS, MAX_SIGNED_URL_TTL_SECONDS);

    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ...(options.downloadFilename
        ? {
            ResponseContentDisposition: `attachment; filename="${sanitiseDisposition(options.downloadFilename)}"`,
          }
        : {}),
    });

    return getSignedUrl(this.client, command, { expiresIn });
  }

  /**
   * S3 has no filesystem path. Callers that need a path (PDFKit, Sharp) must
   * download via `get()` and work from the buffer.
   */
  getLocalPath(): string | null {
    return null;
  }

  /** Presigned PUT, for clients that upload directly and skip the API hop. */
  async getUploadUrl(key: string, contentType: string, expiresIn = 600): Promise<string> {
    const command = new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType });
    return getSignedUrl(this.client, command, { expiresIn });
  }
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * S3 user metadata must be ASCII. Non-ASCII filenames are percent-encoded so the
 * object still records something traceable rather than failing the upload.
 */
function sanitiseMetadata(value: string): string {
  return encodeURIComponent(value).slice(0, 1024);
}

/** Strips characters that would break or inject into a Content-Disposition header. */
function sanitiseDisposition(value: string): string {
  return value.replace(/["\\\r\n]/g, '').slice(0, 200);
}

/** The SDK surfaces a missing object as a 404 or a `NotFound` name. */
function isNotFound(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return (
    candidate.name === 'NoSuchKey' ||
    candidate.name === 'NotFound' ||
    candidate.$metadata?.httpStatusCode === 404
  );
}

export function createS3Storage(): S3Storage {
  return new S3Storage();
}
