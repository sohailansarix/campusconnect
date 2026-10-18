# CampusConnect

CampusConnect connects campus participation with career readiness in one evidence based student journey. Phase 1 covers authentication and role based access, event discovery and registration, QR event passes and attendance, certificates and public verification, college analytics, and in app/email notifications. Phase 2 adds verified skill assessments, career roadmaps, courses and lesson progress, mentor reviewed projects, internship and industry project applications, a resume builder, and a shareable Career Passport.

## Architecture

- `apps/web` is a responsive Next.js App Router frontend.
- `apps/api` is a versioned Express REST API with Prisma services, validation, role checks, audit logging, mail and storage adapters.
- `packages/shared` holds the Zod schemas, TypeScript contracts, constants, and shared permission matrix.
- PostgreSQL stores tenant scoped college and student data. Prisma schema, initial migration, and deterministic demo seed live in `apps/api/prisma`.

```text
apps/
  api/
    prisma/       schema, migrations, seed data
    src/
      modules/    auth, users, colleges, clubs, events, attendance, certificates,
                  analytics, notifications, uploads, passport, skills, learning,
                  projects, internships, resumes
      services/   AI, mail, and storage adapters
      middleware/ auth, RBAC, validation, rate limits, errors
  web/
    src/
      app/        marketing, auth, event, verification, learning, internship,
                  passport, resume, and dashboard routes
      components/ layout, journey, and shared UI
      hooks/      API and notification hooks
      lib/        API client, session, and site configuration
packages/
  shared/src/     shared schemas, types, constants, and RBAC
```

## Requirements

- Node.js 20 or newer
- npm 10 or newer
- Docker with the Compose plugin (or a PostgreSQL 16 database)

## Local setup

From the repository root:

```bash
npm install
cp .env.example .env
npm run db:up
npm run db:migrate
npm run db:seed
npm run dev
```

The API loads the root `.env`; the Next.js config loads the same file for its `NEXT_PUBLIC_*` settings. Keep the sample values for local development only. Replace the JWT and QR secrets, database credentials, SMTP/S3 settings, and public URLs before deploying.

The API is available at `http://localhost:4000/api/v1`; Swagger UI is at `http://localhost:4000/api/docs` during development. The web app is at `http://localhost:3000`.

To run one side at a time, use `npm run dev:api` or `npm run dev:web`. To use an existing PostgreSQL database instead of Compose, set `DATABASE_URL` in `.env`, then run `npm run db:migrate` and `npm run db:seed`.

## Supabase PostgreSQL

The API uses Prisma with PostgreSQL, so Supabase works through `DATABASE_URL`; the browser never receives database credentials. Create a Supabase project, open **Connect**, and copy its **Session Pooler** URL (port `5432`) into the root `.env` as `DATABASE_URL`. This API is a persistent Express server, so use a direct connection when the host supports IPv6, or the Session Pooler when it needs IPv4. Do not use the Transaction Pooler URL (port `6543`) with this server. URL-encode reserved characters in the database password and keep the connection string out of source control.

Apply the committed schema with `npm run db:migrate:deploy`. Do not run `npm run db:seed` against a live Supabase database: it truncates the tables and inserts fictional demo records. The full seed is for local development only. See [Supabase's Prisma connection guide](https://supabase.com/docs/guides/database/prisma) for the current connection details.

The migration creates the schema but does not create a real college or publish learning content. Add the actual college, its administrator, and approved course, assessment, project, and internship records before student onboarding; the fictional local seed is intentionally blocked for non-local database hosts.

## Demo accounts

The local demo seed creates two colleges, 50 students, 20 events, 10 courses, 15 job and internship opportunities, and five placeholder employers. It also creates the Rahul Sharma example persona. All seeded users share the password in `SEED_DEFAULT_PASSWORD` (default: `Password@123`).

| Role | Email |
| --- | --- |
| Student — Rahul Sharma | `rahul.sharma@xyzcollege.example.edu.in` |
| College admin / placement officer | `placement.officer@xyzcollege.example.edu.in` |
| Faculty coordinator | `faculty@xyzcollege.example.edu.in` |
| Trainer / mentor | `trainer@campusconnect.example` |
| Employer recruiter | `hiring@northwind-analytics.example` |
| Platform super admin | `admin@campusconnect.example` |

All company names, testimonials, logos, and landing page statistics are illustrative placeholders.

## Useful commands

```bash
npm run build       # build shared contracts, API, and web app
npm run typecheck   # typecheck all workspaces
npm run lint        # lint the web app
npm run db:studio   # open Prisma Studio
npm run db:down     # stop local services
```

The API defaults to local disk storage and console email in development. Set `STORAGE_DRIVER=s3` and `MAIL_DRIVER=smtp` with the matching credentials to use those adapters. AI, push messaging, WhatsApp/SMS, and payments remain adapter stubs until their later phases.
