import { createApp } from './app.js';

/** Vercel's Express runtime expects the app as the default export. */
const app = createApp();

export default app;
