/**
 * Transport-level types shared across the API and web app.
 *
 * These describe the wire format only. Domain shapes live in `./schemas`.
 */

export type ApiSuccess<T> = {
  success: true;
  data: T;
  meta?: PaginationMeta | Record<string, unknown>;
};

export type ApiErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'PAYLOAD_TOO_LARGE'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'INTERNAL_ERROR'
  | 'CAPACITY_FULL'
  | 'ALREADY_REGISTERED'
  | 'TOKEN_EXPIRED'
  | 'TOKEN_INVALID'
  | 'CERTIFICATE_REVOKED';

export type ApiErrorBody = {
  success: false;
  error: {
    code: ApiErrorCode;
    message: string;
    /** Field-level details from Zod, when the failure was validation. */
    details?: { path: string; message: string }[];
    /** Correlation id — also written to the server log for this request. */
    requestId?: string;
  };
};

export type ApiResponse<T> = ApiSuccess<T> | ApiErrorBody;

export type PaginationMeta = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
};

export type Paginated<T> = {
  items: T[];
  meta: PaginationMeta;
};

/** Query params accepted by every list endpoint. */
export type ListQuery = {
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  search?: string;
};

/** The authenticated principal attached to `req.user` by the auth middleware. */
export type AuthPrincipal = {
  id: string;
  email: string;
  role: import('./constants.js').Role;
  fullName: string;
  collegeId: string | null;
  departmentId: string | null;
  /** Employers carry their employer profile id so job scoping needs no extra query. */
  employerId?: string | null;
};

export type TokenPair = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
};

/** Result of a public certificate verification lookup. */
export type CertificateVerification = {
  valid: boolean;
  certificateId: string;
  type: import('./constants.js').CertificateType;
  status: import('./constants.js').CertificateStatus;
  issuedAt: string | null;
  recipientName: string;
  issuer: { collegeName: string; collegeLogoUrl?: string | null; departmentName?: string | null };
  event?: { title: string; startAt: string; endAt: string; venue?: string | null } | null;
  course?: { title: string } | null;
  revokedReason?: string | null;
  verifiedAt: string;
};

/** The QR payload embedded in a digital event pass. */
export type EventPassPayload = {
  /** Signed token — opaque to the client, validated server-side. */
  token: string;
  eventId: string;
  registrationId: string;
  studentName: string;
  eventTitle: string;
  startAt: string;
  venue?: string | null;
  /** Shown inside the QR so a human can read it if a scanner fails. */
  humanCode: string;
};

export type NotificationPayload = {
  id: string;
  type: import('./constants.js').NotificationType;
  title: string;
  body: string;
  actionUrl?: string | null;
  readAt?: string | null;
  createdAt: string;
};
