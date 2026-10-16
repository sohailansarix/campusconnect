import type { Express } from 'express';
import { env } from './env.js';
import { API_PREFIX, SWAGGER_PATH } from '@campusconnect/shared';

/**
 * OpenAPI documentation.
 *
 * The spec is written by hand rather than generated. That is a deliberate trade:
 * a generator produces complete-but-useless output (every Prisma field, no
 * descriptions), whereas a hand-written spec documents the twenty endpoints a
 * frontend developer or integration partner actually needs, with the error shapes
 * and the reasoning. Coverage grows as integrations demand it.
 *
 * Mounted only outside production — an interactive console that can issue
 * authenticated requests against live student data is not something to expose on
 * the public internet.
 */

/** Shared response components, so each path does not restate them. */
const components = {
  securitySchemes: {
    bearerAuth: {
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
      description:
        'Access token from `POST /auth/login`. Short-lived (15 minutes); refresh with `POST /auth/refresh`.',
    },
  },
  schemas: {
    Success: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: { type: 'object' },
        meta: { $ref: '#/components/schemas/PaginationMeta' },
      },
      required: ['success', 'data'],
    },
    Error: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: false },
        error: {
          type: 'object',
          properties: {
            code: {
              type: 'string',
              enum: [
                'VALIDATION_ERROR',
                'UNAUTHENTICATED',
                'FORBIDDEN',
                'NOT_FOUND',
                'CONFLICT',
                'RATE_LIMITED',
                'CAPACITY_FULL',
                'ALREADY_REGISTERED',
                'TOKEN_EXPIRED',
                'TOKEN_INVALID',
                'CERTIFICATE_REVOKED',
                'INTERNAL_ERROR',
              ],
            },
            message: { type: 'string' },
            details: {
              type: 'array',
              items: {
                type: 'object',
                properties: { path: { type: 'string' }, message: { type: 'string' } },
              },
            },
            requestId: { type: 'string', description: 'Quote this when reporting a bug.' },
          },
        },
      },
      required: ['success', 'error'],
    },
    PaginationMeta: {
      type: 'object',
      properties: {
        page: { type: 'integer', example: 1 },
        pageSize: { type: 'integer', example: 20 },
        total: { type: 'integer', example: 137 },
        totalPages: { type: 'integer', example: 7 },
        hasNext: { type: 'boolean' },
        hasPrev: { type: 'boolean' },
      },
    },
    PaginationQuery: {
      type: 'object',
      properties: {
        page: { type: 'integer', minimum: 1, default: 1 },
        pageSize: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
        sortBy: { type: 'string' },
        sortOrder: { type: 'string', enum: ['asc', 'desc'] },
        search: { type: 'string' },
      },
    },
    Event: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        slug: { type: 'string' },
        title: { type: 'string' },
        summary: { type: 'string', nullable: true },
        category: {
          type: 'string',
          enum: ['WORKSHOP', 'SEMINAR', 'HACKATHON', 'COMPETITION', 'BOOTCAMP', 'WEBINAR', 'CULTURAL', 'SPORTS', 'FEST', 'CLUB_ACTIVITY', 'PLACEMENT_DRIVE', 'OTHER'],
        },
        mode: { type: 'string', enum: ['ONLINE', 'OFFLINE', 'HYBRID'] },
        status: {
          type: 'string',
          enum: ['DRAFT', 'PENDING_FACULTY', 'PENDING_ADMIN', 'PUBLISHED', 'REJECTED', 'ONGOING', 'COMPLETED', 'CANCELLED'],
        },
        startAt: { type: 'string', format: 'date-time' },
        endAt: { type: 'string', format: 'date-time' },
        venue: { type: 'string', nullable: true },
        capacity: { type: 'integer', description: '0 means unlimited.' },
        fee: { type: 'integer', description: 'Minor currency units (paise). 0 is free.' },
        registrationCount: { type: 'integer' },
        attendanceCount: { type: 'integer' },
        averageRating: { type: 'number', nullable: true },
      },
    },
    CertificateVerification: {
      type: 'object',
      description:
        'Public verification payload. Deliberately limited to issuer, recipient name, event and dates — see `certificateService.verifyPublic`.',
      properties: {
        valid: { type: 'boolean' },
        certificateId: { type: 'string', example: 'CC-2026-A7F3K2' },
        recipientName: { type: 'string' },
        issuer: {
          type: 'object',
          properties: {
            collegeName: { type: 'string' },
            collegeLogoUrl: { type: 'string', nullable: true },
          },
        },
        event: {
          type: 'object',
          nullable: true,
          properties: {
            title: { type: 'string' },
            startAt: { type: 'string', format: 'date-time' },
            venue: { type: 'string', nullable: true },
          },
        },
        revokedReason: { type: 'string', nullable: true },
        verifiedAt: { type: 'string', format: 'date-time' },
      },
    },
  },
  responses: {
    Unauthenticated: {
      description: 'No valid access token was supplied.',
      content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
    },
    Forbidden: {
      description: 'The caller lacks the permission this endpoint requires.',
      content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
    },
    NotFound: {
      description: 'The requested resource does not exist, or the caller may not know that it does.',
      content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
    },
    ValidationError: {
      description: 'The request failed validation. `error.details` lists the offending fields.',
      content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
    },
    RateLimited: {
      description: 'Too many requests.',
      content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
    },
  },
};

const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'CampusConnect API',
    version: '1.0.0',
    description: `
# CampusConnect — From Campus Experience to Career Readiness

REST API for the CampusConnect platform. Three layers share one identity and one data model:

* **CampusConnect** — events, clubs, attendance, certificates, engagement analytics
* **SkillBridge** — skill assessment, roadmaps, courses, projects, internships, resume building
* **CareerConnect** — jobs, applications, employer pipeline, interview scheduling

The centrepiece is the **Student Career Passport** (\`GET /passport/:username\`), a continuously
updated, evidence-based profile. It is a read model assembled from many tables, so a certificate
earned this morning appears on it immediately.

## Conventions

* All endpoints are under \`${API_PREFIX}\`.
* Every response is either \`{ success: true, data, meta? }\` or \`{ success: false, error }\`.
* List endpoints accept \`page\`, \`pageSize\`, \`sortBy\`, \`sortOrder\`, \`search\`.
* Timestamps are ISO 8601 UTC. Money is an integer in minor units (paise), never a float.
* Rate limits differ by endpoint — credential endpoints are strict
  (\`${env.AUTH_RATE_LIMIT_MAX}\` per window), the rest default to \`${env.RATE_LIMIT_MAX}\`.

## Authentication

\`POST /auth/login\` returns an access token (15 min) and a refresh token (30 days, rotating).
Send the access token as \`Authorization: Bearer <token>\`.

Refresh tokens rotate on every use, and presenting an already-rotated token revokes every session
for that user — this is reuse detection, and it is why the long refresh TTL is safe.

## Privacy

Candidate data is consent-gated. An employer sees a student's passport only when the student has
opted in **and** the employer is verified. Withdrawing consent takes effect immediately — see
\`PUT /passport/mine/privacy\`.

## Error codes

| Code | Meaning |
| --- | --- |
| \`VALIDATION_ERROR\` | 422. \`error.details\` lists field-level problems. |
| \`UNAUTHENTICATED\` | 401. Missing or expired credentials. |
| \`TOKEN_EXPIRED\` | 401. Refresh and retry. |
| \`FORBIDDEN\` | 403. The role lacks the required permission. |
| \`NOT_FOUND\` | 404. Also returned when the caller may not know a resource exists. |
| \`CONFLICT\` | 409. Duplicate, or an invalid state transition. |
| \`CAPACITY_FULL\` | 409. Event at capacity with no waitlist, or waitlist declined. |
| \`ALREADY_REGISTERED\` | 409. |
| \`CERTIFICATE_REVOKED\` | 410. |
| \`RATE_LIMITED\` | 429. |
    `.trim(),
    contact: { name: 'CampusConnect', url: 'https://campusconnect.local' },
    license: { name: 'Proprietary' },
  },
  servers: [
    { url: env.API_URL, description: 'This server' },
    { url: 'http://localhost:4000', description: 'Local development' },
  ],
  tags: [
    { name: 'Health', description: 'Liveness and readiness' },
    { name: 'Auth', description: 'Registration, login, tokens, password reset, invitations' },
    { name: 'Users', description: 'Profiles and student profiles' },
    { name: 'Colleges', description: 'Institutions and departments' },
    { name: 'Clubs', description: 'Clubs and membership' },
    { name: 'Events', description: 'Event lifecycle, approval chain, discovery' },
    { name: 'Attendance', description: 'QR scanning and manual check-in' },
    { name: 'Certificates', description: 'Issuing, rendering and public verification' },
    { name: 'Feedback', description: 'Ratings and moderation' },
    { name: 'Notifications', description: 'Inbox, preferences, broadcasts' },
    { name: 'Analytics', description: 'Engagement, participation, readiness, exports' },
    { name: 'Uploads', description: 'Validated file upload and delivery' },
    { name: 'Passport', description: 'Career Passport, readiness and privacy' },
  ],
  components,
  security: [{ bearerAuth: [] }],
  paths: {
    '/health': {
      get: {
        tags: ['Health'],
        summary: 'Liveness and readiness',
        security: [],
        description:
          'Runs a query against Postgres rather than merely returning 200, so a process that is up but cannot reach the database reports `degraded` with a 503.',
        responses: {
          200: { description: 'Healthy' },
          503: { description: 'Degraded — the database is unreachable' },
        },
      },
    },

    /* ---------------------------------------------------------------- Auth */

    '/auth/register': {
      post: {
        tags: ['Auth'],
        summary: 'Create a student account',
        security: [],
        description:
          'Self-service signup is limited to the STUDENT role. Faculty, employers and administrators are provisioned through `POST /auth/invite`.\n\nStrictly rate limited.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['fullName', 'email', 'password', 'collegeId', 'acceptedTerms'],
                properties: {
                  fullName: { type: 'string', example: 'Rahul Sharma' },
                  email: { type: 'string', format: 'email', example: 'rahul.sharma@xyzcollege.edu.in' },
                  password: {
                    type: 'string',
                    description: 'Minimum 8 characters, with a letter, a number and a symbol.',
                  },
                  collegeId: { type: 'string' },
                  departmentId: { type: 'string' },
                  graduationYear: { type: 'integer', example: 2027 },
                  acceptedTerms: { type: 'boolean', enum: [true] },
                },
              },
            },
          },
        },
        responses: {
          201: {
            description: 'Account created; access and refresh tokens returned.',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Success' } } },
          },
          409: { description: 'An account with that email already exists' },
          422: { $ref: '#/components/responses/ValidationError' },
          429: { $ref: '#/components/responses/RateLimited' },
        },
      },
    },

    '/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Sign in',
        security: [],
        description:
          'Returns 401 with an identical message and comparable timing whether the email is unknown or the password is wrong, so this endpoint cannot be used to enumerate accounts.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password'],
                properties: {
                  email: { type: 'string', format: 'email' },
                  password: { type: 'string' },
                  rememberMe: { type: 'boolean', description: 'Doubles the refresh token lifetime.' },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Signed in. Also sets an httpOnly `cc_refresh` cookie for the web app.',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Success' } } },
          },
          401: { $ref: '#/components/responses/Unauthenticated' },
          429: { $ref: '#/components/responses/RateLimited' },
        },
      },
    },

    '/auth/refresh': {
      post: {
        tags: ['Auth'],
        summary: 'Rotate the refresh token',
        security: [],
        description:
          'Accepts the refresh token from the `cc_refresh` cookie or the body. **The presented token is revoked and replaced.** If an already-rotated token is presented, every session for that user is revoked and the user is notified — this is reuse detection.',
        responses: {
          200: { description: 'New token pair issued' },
          401: { $ref: '#/components/responses/Unauthenticated' },
        },
      },
    },

    '/auth/forgot-password': {
      post: {
        tags: ['Auth'],
        summary: 'Request a password reset',
        security: [],
        description:
          'Always returns the same response, whether or not the account exists. Requesting a reset invalidates any earlier reset link.',
        responses: { 200: { description: 'Request accepted' } },
      },
    },

    '/auth/change-password': {
      post: {
        tags: ['Auth'],
        summary: 'Change your password',
        description:
          'Requires the current password. Revokes every session, including the caller\'s — a password change is often a response to a compromise.',
        responses: {
          200: { description: 'Password changed' },
          422: { $ref: '#/components/responses/ValidationError' },
        },
      },
    },

    '/auth/invite': {
      post: {
        tags: ['Auth'],
        summary: 'Invite a faculty member, trainer or employer',
        description: 'Creates a PENDING_INVITE account with no usable password and emails a setup link. Requires `user:create`.',
        responses: {
          201: { description: 'Invitation sent' },
          403: { $ref: '#/components/responses/Forbidden' },
        },
      },
    },

    /* --------------------------------------------------------------- Events */

    '/events': {
      get: {
        tags: ['Events'],
        summary: 'Browse events',
        security: [],
        description:
          'Works signed out. Signed in, each result additionally carries `viewerRegistration` so a card can render "Registered" without a second request.\n\nOnly PUBLISHED, ONGOING and COMPLETED events are visible to a student; an organiser additionally sees their own drafts.',
        parameters: [
          { name: 'category', in: 'query', schema: { type: 'string' }, description: 'Comma-separated categories' },
          { name: 'mode', in: 'query', schema: { type: 'string' }, description: 'Comma-separated: ONLINE, OFFLINE, HYBRID' },
          { name: 'free', in: 'query', schema: { type: 'boolean' } },
          { name: 'from', in: 'query', schema: { type: 'string', format: 'date' } },
          { name: 'to', in: 'query', schema: { type: 'string', format: 'date' } },
          { name: 'registered', in: 'query', schema: { type: 'boolean' }, description: 'Only events the caller registered for' },
          { name: 'available', in: 'query', schema: { type: 'boolean' }, description: 'Only events with seats remaining' },
          { name: 'search', in: 'query', schema: { type: 'string' } },
          { name: 'page', in: 'query', schema: { type: 'integer' } },
          { name: 'pageSize', in: 'query', schema: { type: 'integer', maximum: 100 } },
        ],
        responses: {
          200: {
            description: 'Paginated event list',
            content: {
              'application/json': {
                schema: {
                  allOf: [
                    { $ref: '#/components/schemas/Success' },
                    { type: 'object', properties: { data: { type: 'array', items: { $ref: '#/components/schemas/Event' } } } },
                  ],
                },
              },
            },
          },
        },
      },
      post: {
        tags: ['Events'],
        summary: 'Create an event (draft)',
        description:
          'Created as DRAFT. Submit it with `POST /events/:id/submit` to start the approval chain. Requires `event:create`.',
        responses: {
          201: { description: 'Draft created' },
          403: { $ref: '#/components/responses/Forbidden' },
          422: { $ref: '#/components/responses/ValidationError' },
        },
      },
    },

    '/events/{id}': {
      get: {
        tags: ['Events'],
        summary: 'Event detail',
        security: [],
        description:
          'Accepts either the slug or the id. An unapproved event returns 404 rather than 403, so a stranger cannot infer that it exists.',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'Event with approval history and viewer stats' },
          404: { $ref: '#/components/responses/NotFound' },
        },
      },
      patch: {
        tags: ['Events'],
        summary: 'Update an event',
        description:
          'Timing is re-validated against the merged record. Moving a published event that already has registrations returns it to review, and notifies those registrants.',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'Updated' },
          409: { description: 'Capacity below the number already registered, or schedule change requires approval' },
        },
      },
    },

    '/events/{id}/submit': {
      post: {
        tags: ['Events'],
        summary: 'Submit for approval',
        description: 'Completeness is checked first — a reviewer is never asked to approve an event with no venue or a missing description.',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'Moved to PENDING_FACULTY' },
          422: { description: 'The event is incomplete' },
        },
      },
    },

    '/events/{id}/decide': {
      post: {
        tags: ['Events'],
        summary: 'Approve or reject an event',
        description:
          'The chain is FACULTY then ADMIN. A college admin may clear both stages in one call when no coordinator is involved.\n\nAn organiser cannot approve their own event — that is the point of the chain.',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['decision'],
                properties: {
                  decision: { type: 'string', enum: ['APPROVE', 'REJECT', 'REQUEST_CHANGES'] },
                  note: { type: 'string', description: 'Required for REJECT and REQUEST_CHANGES.' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Decision recorded' },
          403: { description: 'The caller cannot review their own event' },
          409: { description: 'The event is not awaiting review' },
        },
      },
    },

    '/events/{id}/register': {
      post: {
        tags: ['Events'],
        summary: 'Register for an event',
        description:
          '**Concurrency-safe.** The capacity check and the insert run in one transaction that locks the event row, so two simultaneous requests for the last seat cannot both succeed.\n\nA full event with a waitlist returns `WAITLISTED` with a queue position.',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  responses: { type: 'object', additionalProperties: { type: 'string' } },
                  acceptWaitlist: { type: 'boolean', default: true },
                  paymentReference: { type: 'string', description: 'Required for a paid event.' },
                },
              },
            },
          },
        },
        responses: {
          201: { description: 'Registered, waitlisted, or awaiting payment' },
          409: { description: 'Already registered, or the event is full with no waitlist' },
          403: { description: 'Not at your college, wrong year of study, or wrong department' },
        },
      },
    },

    '/events/{id}/registrations': {
      get: {
        tags: ['Events'],
        summary: 'Event roster',
        description: 'Contains student emails and phone numbers. Requires `event:manage_attendance` and management of this event.',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'Paginated roster with attendance state per student' },
          403: { $ref: '#/components/responses/Forbidden' },
        },
      },
    },

    /* ------------------------------------------------------------ Attendance */

    '/attendance/scan': {
      post: {
        tags: ['Attendance'],
        summary: 'Scan an event pass',
        description:
          'The pass QR encodes a **signed token** bound to one registration and one event, so a screenshot cannot be reused at another event.\n\nA rejection (wrong event, waitlisted, cancelled) is a **200 with `outcome: REJECTED`**, not a 4xx — the scanner screen needs to render the student\'s name and the reason as a distinct state.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['token', 'eventId'],
                properties: {
                  token: { type: 'string', description: 'Raw value decoded from the QR code.' },
                  eventId: { type: 'string' },
                  deviceLabel: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Scan processed — check `outcome`' },
          201: { description: 'Student admitted' },
          401: { $ref: '#/components/responses/Unauthenticated' },
        },
      },
    },

    '/attendance/manual': {
      post: {
        tags: ['Attendance'],
        summary: 'Manual check-in',
        description:
          'The fallback when a pass cannot be scanned. **A reason is required** and is written to both the attendance row and the audit log — an unexplained manual override is what a certificate dispute turns on.',
        responses: {
          201: { description: 'Marked present' },
          422: { $ref: '#/components/responses/ValidationError' },
        },
      },
    },

    '/attendance/live': {
      get: {
        tags: ['Attendance'],
        summary: 'Live counters and recent scans',
        description: 'Polled by the scanner screen while the door is open.',
        parameters: [{ name: 'eventId', in: 'query', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Counters, attendance rate, recent scans and who is still expected' } },
      },
    },

    /* ---------------------------------------------------------- Certificates */

    '/certificates/verify/{certificateId}': {
      get: {
        tags: ['Certificates'],
        summary: 'Verify a certificate publicly',
        security: [],
        description:
          '**The only unauthenticated read in the platform, and it is intentional** — the value of a verifiable certificate is that anyone holding the printed document can confirm it.\n\nThe response is a strict field allowlist: issuer, recipient name, event and dates. Never the student\'s email, id or score. A certificate ID is semi-public, so it must not be a key to anything else.',
        parameters: [
          {
            name: 'certificateId',
            in: 'path',
            required: true,
            schema: { type: 'string', example: 'CC-2026-A7F3K2' },
          },
        ],
        responses: {
          200: {
            description: 'Verification result. A malformed or unknown id returns `valid: false`, not a 4xx.',
            content: {
              'application/json': {
                schema: {
                  allOf: [
                    { $ref: '#/components/schemas/Success' },
                    { type: 'object', properties: { data: { $ref: '#/components/schemas/CertificateVerification' } } },
                  ],
                },
              },
            },
          },
        },
      },
    },

    '/certificates/issue/event': {
      post: {
        tags: ['Certificates'],
        summary: 'Bulk-issue certificates for an event',
        description:
          '**Only students with a non-revoked attendance record are eligible** — eligibility is derived from attendance, never from a client-supplied list.\n\nIdempotent per student: re-running after a partial failure does not create duplicates unless `reissue` is set. Rate limited, because one call can enqueue thousands of emails.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['eventId'],
                properties: {
                  eventId: { type: 'string' },
                  studentIds: { type: 'array', items: { type: 'string' }, description: 'Omit for all attendees.' },
                  position: { type: 'string', example: 'Winner' },
                  sendEmail: { type: 'boolean', default: true },
                  reissue: { type: 'boolean', default: false },
                },
              },
            },
          },
        },
        responses: {
          201: { description: 'Issued / skipped / failed counts and the new certificate ids' },
          409: { description: 'Certificates are disabled for this event' },
        },
      },
    },

    /* -------------------------------------------------------------- Passport */

    '/passport/{username}': {
      get: {
        tags: ['Passport'],
        summary: 'The Student Career Passport',
        security: [],
        description:
          'Public so a shared link works — that is the point of a shareable passport URL.\n\nPrivacy is enforced server-side:\n\n* **PUBLIC** — anyone with the link\n* **EMPLOYERS_ONLY** — a *verified* employer, and only when the student has opted in to employer search. Verification alone is not consent.\n* **PRIVATE** — the owner and platform admins only\n\nCollege staff can read passports within their own college. A 403 carries a human-readable reason the page renders directly.',
        parameters: [{ name: 'username', in: 'path', required: true, schema: { type: 'string', example: 'rahul-sharma' } }],
        responses: {
          200: { description: 'Assembled passport with readiness score and breakdown' },
          403: { description: 'The viewer may not see this passport; the message explains why' },
          404: { $ref: '#/components/responses/NotFound' },
        },
      },
    },

    '/passport/{username}/export': {
      get: {
        tags: ['Passport'],
        summary: 'Export a passport as PDF',
        security: [],
        description: 'Same visibility check as the HTML view. Renders through the resume layout, which is what an employer\'s process expects.',
        parameters: [{ name: 'username', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'application/pdf' }, 403: { description: 'Not visible to this viewer' } },
      },
    },

    '/passport/mine/privacy': {
      put: {
        tags: ['Passport'],
        summary: 'Change passport visibility and employer consent',
        description:
          'Both values are audited with their previous state — an institution investigating a complaint needs to know *when* consent was withdrawn, not merely that it is currently absent.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  visibility: { type: 'string', enum: ['PUBLIC', 'EMPLOYERS_ONLY', 'PRIVATE'] },
                  consentToEmployerSearch: { type: 'boolean' },
                },
              },
            },
          },
        },
        responses: { 200: { description: 'Updated' } },
      },
    },

    /* ------------------------------------------------------------- Analytics */

    '/analytics/overview': {
      get: {
        tags: ['Analytics'],
        summary: 'College dashboard KPIs',
        description:
          'Engagement is measured from **attendance**, not registration — a student who registered and did not turn up is not engaged.\n\nRequires `analytics:read_college`; every query is additionally scoped to the caller\'s college.',
        parameters: [
          { name: 'from', in: 'query', schema: { type: 'string', format: 'date' }, description: 'Defaults to 90 days ago.' },
          { name: 'to', in: 'query', schema: { type: 'string', format: 'date' } },
        ],
        responses: {
          200: { description: 'Student, event, certificate, club and readiness KPIs' },
          403: { $ref: '#/components/responses/Forbidden' },
        },
      },
    },

    '/analytics/readiness': {
      get: {
        tags: ['Analytics'],
        summary: 'Career-readiness distribution and skill gaps',
        description:
          'Combines the readiness distribution with the gaps behind it, so the officer can act on the number: "68% of final years below 60, dominant gap SQL" is a training plan.\n\nGaps are defined against the skills this college\'s employers actually ask for, not against an arbitrary catalogue.',
        responses: { 200: { description: 'Distribution, per-department averages, top gaps, placement funnel' } },
      },
    },

    '/analytics/export': {
      get: {
        tags: ['Analytics'],
        summary: 'Export a report as CSV',
        description:
          'One endpoint, seven reports. Every export writes an audit row — "who downloaded every student\'s phone number" is the question an institution asks after an incident, and it cannot be answered retrospectively.',
        parameters: [
          {
            name: 'report',
            in: 'query',
            required: true,
            schema: {
              type: 'string',
              enum: [
                'EVENT_ENGAGEMENT',
                'ATTENDANCE',
                'CERTIFICATES',
                'STUDENT_ENGAGEMENT',
                'PLACEMENT_FUNNEL',
                'DEPARTMENT_COMPARISON',
                'APPLICATIONS',
              ],
            },
          },
          { name: 'from', in: 'query', schema: { type: 'string', format: 'date' } },
          { name: 'to', in: 'query', schema: { type: 'string', format: 'date' } },
        ],
        responses: {
          200: { description: 'text/csv, UTF-8 with BOM so Excel does not mangle non-ASCII names' },
          429: { $ref: '#/components/responses/RateLimited' },
        },
      },
    },
  },
} as const;

/**
 * Mounts the docs UI.
 *
 * Skipped entirely in production, and the import is dynamic so the Swagger bundle
 * is not loaded in a production process at all.
 */
export function mountDocs(app: Express): void {
  if (env.isProduction) {
    logger.info('API docs are disabled in production');
    return;
  }

  // Dynamic import keeps swagger-ui-express out of the production module graph.
  void (async () => {
    try {
      const [{ default: swaggerUi }, { default: express }] = await Promise.all([
        import('swagger-ui-express'),
        import('express'),
      ]);

      // The spec is served as JSON so it can be imported into Postman or Insomnia.
      app.get(`${SWAGGER_PATH}.json`, (_req, res) => {
        res.json(openApiSpec);
      });

      app.use(
        SWAGGER_PATH,
        swaggerUi.serve,
        swaggerUi.setup(openApiSpec as never, {
          customSiteTitle: 'CampusConnect API',
          swaggerOptions: {
            persistAuthorization: true,
            displayRequestDuration: true,
            tryItOutEnabled: true,
            tagsSorter: 'alpha',
          },
        }),
      );

      // A minimal `express.json`-free redirect so /api/docs works without a trailing slash.
      app.get('/api/docs', (_req, res) => res.redirect(SWAGGER_PATH));
    } catch (error) {
      // Docs are a convenience; a failure to mount them must not stop the API.
      logger.warn('Could not mount the API docs UI', { error: String(error) });
    }
  })();
}

export { openApiSpec };

/** Local import of the logger, kept at the bottom to avoid a circular import. */
import { logger } from './logger.js';
