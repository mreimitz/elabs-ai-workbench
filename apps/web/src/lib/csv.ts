/**
 * Client-side CSV export helpers for the answer/reasoning data tables (WP 6.1).
 *
 * The repo has no client-side download helper — every other export is a server-driven
 * `<a href="/api/reports/…">`. The answer tables, though, hold data the browser already has
 * (a `Acme.Snapshot` hypercube, a reasoning asset list, or a rendered markdown table), so their
 * "download" acts on what's on screen. These two functions are the whole of it: {@link toCsv} is a
 * pure, unit-testable serializer; {@link downloadCsv} is the thin DOM side-effect that saves it.
 */

/**
 * Serialize a header row + data rows to an RFC-4180-ish CSV string.
 *
 * A cell is quoted only when it must be — it contains a double-quote, a comma, or a line break —
 * and interior double-quotes are doubled (`"` → `""`). Numbers serialize via `String(n)` (no locale
 * grouping, so the CSV re-imports cleanly). Rows are joined with CRLF per the spec. Ragged rows are
 * tolerated: a short row simply emits fewer cells (no padding, never throws).
 */
export function toCsv(headers: string[], rows: (string | number)[][]): string {
  const lines = [headers.map(escapeCsvCell).join(",")];
  for (const row of rows) {
    lines.push(row.map(escapeCsvCell).join(","));
  }
  return lines.join("\r\n");
}

/** One cell → its CSV field, quoted + escaped only when the content forces it. */
function escapeCsvCell(value: string | number): string {
  const text = typeof value === "number" ? String(value) : value;
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

/**
 * Save a CSV string to a file via a transient object-URL anchor click. Web-only side effect: it
 * builds a `text/csv` Blob, hangs it off an off-DOM `<a download>`, clicks it, and revokes the URL.
 * Pulled out of the component so the DOM plumbing is stubbable in a test (mock `createObjectURL` +
 * spy the anchor click).
 */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = "noopener";
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}
