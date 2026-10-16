/**
 * Server-side input sanitisation.
 *
 * Two distinct problems, handled separately:
 *
 *  1. Stored XSS — user-authored rich-ish text (event descriptions, feedback
 *     comments, project briefs) is written to the database and later rendered.
 *     We strip every tag on write rather than trusting each render site to
 *     escape, because one missed `dangerouslySetInnerHTML` is a stored XSS.
 *
 *  2. Query-filter injection — Prisma parameterises values, so the risk is not
 *     SQL injection but *operator* injection: a client sending
 *     `{"email": {"contains": "a"}}` where a string is expected, or `$queryRaw`
 *     fragments. We reject objects where primitives are expected.
 */

import sanitizeHtml from 'sanitize-html';

const STRIP_ALL: sanitizeHtml.IOptions = {
  allowedTags: [],
  allowedAttributes: {},
  // Preserve the text of a stripped tag rather than dropping its content, so
  // "<b>Great</b> event" becomes "Great event" rather than " event".
  nonTextTags: ['script', 'style', 'textarea', 'option', 'noscript'],
};

/** Plain-text field (names, titles, comments). Collapses whitespace runs. */
export function sanitizeText(input: string | null | undefined, maxLength?: number): string {
  if (!input) return '';
  const stripped = sanitizeHtml(input, STRIP_ALL)
    // Decode the entities sanitize-html emits for quotes/ampersands back to
    // their literal characters — we are producing plain text, not HTML.
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

  return maxLength ? stripped.slice(0, maxLength) : stripped;
}

/**
 * Multi-line plain text (descriptions, briefs, feedback bodies). Keeps line
 * breaks but still removes every tag.
 */
export function sanitizeMultilineText(input: string | null | undefined, maxLength?: number): string {
  if (!input) return '';
  const cleaned = sanitizeHtml(input, STRIP_ALL)
    .replace(/\r\n/g, '\n')
    // Cap consecutive blank lines — a wall of newlines is a layout attack.
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trimEnd())
    .join('\n')
    .trim();

  return maxLength ? cleaned.slice(0, maxLength) : cleaned;
}

/** Allowlisted HTML for the few fields rendered as HTML (course lesson bodies). */
const RICH_ALLOWED: sanitizeHtml.IOptions = {
  allowedTags: [
    'p', 'br', 'strong', 'em', 'u', 's', 'ul', 'ol', 'li', 'blockquote',
    'h2', 'h3', 'h4', 'code', 'pre', 'a', 'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'img',
  ],
  allowedAttributes: {
    a: ['href', 'title', 'target', 'rel'],
    img: ['src', 'alt', 'title', 'width', 'height'],
    code: ['class'],
  },
  // Blocks javascript:, data: and vbscript: URLs.
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesAppliedToAttributes: ['href', 'src'],
  transformTags: {
    a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer nofollow', target: '_blank' }),
  },
};

export function sanitizeRichText(input: string | null | undefined, maxLength = 20_000): string {
  if (!input) return '';
  return sanitizeHtml(input, RICH_ALLOWED).slice(0, maxLength);
}

/**
 * Recursively sanitise every string in a payload. Used by the validate
 * middleware on request bodies, so a module cannot forget to sanitise a field.
 */
export function sanitizeDeep<T>(value: T, maxStringLength = 20_000): T {
  if (typeof value === 'string') return sanitizeText(value, maxStringLength) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => sanitizeDeep(v, maxStringLength)) as unknown as T;
  if (value !== null && typeof value === 'object') {
    if (value instanceof Date) return value;
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = sanitizeDeep(val, maxStringLength);
    }
    return out as unknown as T;
  }
  return value;
}

/* -------------------------------------------------------------------------- */
/* Operator-injection guards                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Prisma treats `{ contains: ... }` style objects as filters. A body field that
 * reaches a `where` clause without being coerced to a primitive could therefore
 * become an operator. We reject such values at the boundary.
 */
export function assertPrimitive(value: unknown, fieldName: string): void {
  if (value === null || value === undefined) return;
  if (typeof value === 'object') {
    throw new Error(
      `Field "${fieldName}" must be a primitive value (received ${Array.isArray(value) ? 'array' : 'object'})`,
    );
  }
}

/**
 * Rejects `__proto__` / `constructor` / `prototype` keys, which can poison
 * object lookups (e.g. `rolePermissions[role]`) if merged into a plain object.
 */
export function assertNoPrototypePollution(value: unknown, path = 'body'): void {
  if (value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((item, i) => assertNoPrototypePollution(item, `${path}[${i}]`));
    return;
  }
  for (const key of Object.keys(value)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      throw new Error(`Unsafe key "${key}" at ${path}`);
    }
    assertNoPrototypePollution((value as Record<string, unknown>)[key], `${path}.${key}`);
  }
}

/* -------------------------------------------------------------------------- */
/* Output escaping                                                            */
/* -------------------------------------------------------------------------- */

/** Escape for CSV cells, which Excel will otherwise interpret as formulas. */
export function csvSafe(value: string): string {
  if (/^[=+\-@\t\r]/.test(value)) return `'${value}`;
  return value;
}

/** Minimal HTML escape for interpolating into the email templates. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
