import type { NextConfig } from 'next';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(appDirectory, '../..');

// Keep the root .env.example useful for both the API and Next.js. App-specific
// environment values loaded by Next already take precedence.
dotenv.config({ path: path.join(repositoryRoot, '.env'), override: false });

const nextConfig: NextConfig = {
  reactStrictMode: true,

  /**
   * The shared workspace package is consumed as source rather than as a built
   * artefact, so a change to a Zod schema is picked up without rebuilding the
   * package. Next needs to be told to transpile it.
   */
  transpilePackages: ['@campusconnect/shared'],

  /** Resolve the shared package's NodeNext-style `.js` specifiers to its TS
   * source files while Next transpiles that workspace package in development. */
  webpack(config) {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      '.js': ['.ts', '.tsx', '.js'],
    };
    return config;
  },

  /**
   * Remote image hosts. In development the API serves uploads from localhost; in
   * production the host comes from the storage/CDN domain.
   */
  images: {
    remotePatterns: [
      { protocol: 'http', hostname: 'localhost' },
      { protocol: 'https', hostname: '**' },
    ],
    formats: ['image/webp'],
  },

  async headers() {
    return [
      {
        // Applied to every route. The CSP is permissive enough for Recharts
        // (inline styles) and Next's own runtime, and strict enough to block an
        // injected script from an external origin.
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            // The QR scanner needs the camera; nothing else needs a device API.
            value: 'camera=(self), microphone=(), geolocation=(), payment=()',
          },
        ],
      },
    ];
  },

  eslint: {
    // Lint runs as its own CI step; failing a production build on a lint warning
    // slows deploys without adding safety.
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
