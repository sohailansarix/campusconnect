import { createApp } from './app.js';

/**
 * Vercel's Express entrypoint exports the app as a request handler. The regular
 * server bootstrap remains in `server.ts` for local and non-Vercel deployments.
 */
const app = createApp();

export default app;
