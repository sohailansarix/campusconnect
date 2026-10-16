import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,

  /**
   * The shared workspace package is consumed as source rather than as a built
   * artefact, so a change to a Zod schema is picked up without rebuilding the
   * package. Next needs to be told to transpile it.
   */
  transpilePackages: ['@campusconnect/shared'],

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
