/**
 * CSV serialisation for the analytics exports.
 *
 * Two details that bite in practice and are handled here:
 *
 *  * Excel on Windows opens UTF-8 CSVs as mojibake unless the file starts with a
 *    BOM. Student names are frequently non-ASCII, so we always emit one.
 *  * A cell beginning with `=`, `+`, `-` or `@` is executed as a formula by Excel
 *    and Sheets. Every value goes through `csvSafe` (see utils/sanitize.ts).
 */

import { csvSafe } from './sanitize.js';

const BOM = '﻿';

export type CsvColumn<Row> = {
  /** Header text. */
  header: string;
  /** Cell value — return null/undefined for an empty cell. */
  value: (row: Row) => string | number | boolean | Date | null | undefined;
};

function formatCell(value: CsvColumn<never>['value'] extends never ? never : unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  return csvSafe(String(value));
}

function escapeCell(raw: string): string {
  // Quote when the cell contains a delimiter, a quote or a newline.
  if (/[",\n\r]/.test(raw)) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

export function toCsv<Row>(rows: Row[], columns: CsvColumn<Row>[], options: { bom?: boolean } = {}): string {
  const header = columns.map((c) => escapeCell(csvSafe(c.header))).join(',');
  const body = rows
    .map((row) =>
      columns
        .map((column) => escapeCell(formatCell(column.value(row) as unknown)))
        .join(','),
    )
    .join('\r\n');

  const csv = body.length > 0 ? `${header}\r\n${body}` : header;
  return (options.bom ?? true) ? BOM + csv : csv;
}

/**
 * Filename for a download. The report name is slugified so a stray slash or a
 * non-ASCII character cannot break the Content-Disposition header.
 */
export function csvFilename(report: string, from?: Date, to?: Date): string {
  const slug = report
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const stamp = (date?: Date) => (date ? date.toISOString().slice(0, 10) : null);
  const fromPart = stamp(from);
  const toPart = stamp(to);
  const range = fromPart && toPart ? `-${fromPart}-to-${toPart}` : `-${new Date().toISOString().slice(0, 10)}`;
  return `campusconnect-${slug}${range}.csv`;
}

/** Sets the download headers and writes the body. */
export function sendCsv(
  res: { setHeader: (k: string, v: string) => void; send: (body: string) => void },
  csv: string,
  filename: string,
): void {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  // Exports are generated per request and must never be cached by a proxy.
  res.setHeader('Cache-Control', 'no-store');
  res.send(csv);
}

/* -------------------------------------------------------------------------- */
/* Shared column sets                                                         */
/* -------------------------------------------------------------------------- */

export const DATE_FORMATTER = new Intl.DateTimeFormat('en-IN', {
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  timeZone: 'Asia/Kolkata',
});

export const DATETIME_FORMATTER = new Intl.DateTimeFormat('en-IN', {
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Asia/Kolkata',
});

export function formatDate(date: Date | null | undefined): string {
  return date ? DATE_FORMATTER.format(date) : '';
}

export function formatDateTime(date: Date | null | undefined): string {
  return date ? DATETIME_FORMATTER.format(date) : '';
}

/** Rupees from minor units, for report columns. */
export function formatCurrency(minorUnits: number | null | undefined, currency = 'INR'): string {
  if (minorUnits === null || minorUnits === undefined) return '';
  const symbol = currency === 'INR' ? '₹' : '';
  return `${symbol}${(minorUnits / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}
