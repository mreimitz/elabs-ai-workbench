// Assistant Hub — v1-fixes attachment ingestion: file → markdown conversion so EVERY model kind can
// read chat attachments (pdf/docx/xlsx/pptx/html), plus the content-part folding rules. All offline.

import assert from "node:assert/strict";
import { test } from "node:test";
import { zipSync, strToU8 } from "fflate";
import {
  convertAttachmentToMarkdown,
  converterFor,
} from "../src/hub/files/ingest.js";
import { attachmentToContentParts } from "../src/hub/turn-engine.js";

// ── converter dispatch ─────────────────────────────────────────────────────────────────────────────

test("converterFor: mime wins, filename extension backstops generic mimes, images stay unconverted", () => {
  assert.equal(converterFor("application/pdf"), "pdf");
  assert.equal(converterFor("application/octet-stream", "report.pdf"), "pdf");
  assert.equal(
    converterFor("application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
    "docx",
  );
  assert.equal(
    converterFor("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
    "xlsx",
  );
  assert.equal(converterFor("application/octet-stream", "deck.pptx"), "pptx");
  assert.equal(converterFor("text/html"), "html");
  assert.equal(converterFor("image/png", "photo.png"), undefined);
  assert.equal(converterFor("text/plain", "notes.txt"), undefined, "text-like inlines raw already");
});

// ── xlsx (SheetJS round-trip, no fixtures) ─────────────────────────────────────────────────────────

test("xlsx → markdown pipe tables per sheet, with honest row truncation", async () => {
  const XLSX = await import("xlsx");
  const rows = [
    ["Region", "Revenue", "Attainment"],
    ["Europe", "575.91M", "19.1%"],
    ["Asia", "749.78M", "17.7%"],
  ];
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Sales");
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;

  const converted = await convertAttachmentToMarkdown({
    filename: "sales.xlsx",
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    content: buffer,
  });
  assert.ok(converted, "xlsx converts");
  assert.equal(converted.converter, "xlsx");
  assert.match(converted.markdown, /## Sheet: Sales/);
  assert.match(converted.markdown, /\| Region \| Revenue \| Attainment \|/);
  assert.match(converted.markdown, /\| Europe \| 575\.91M \| 19\.1% \|/);
});

// ── html → markdown (turndown + GFM tables) ────────────────────────────────────────────────────────

test("html → markdown keeps headings and GFM tables", async () => {
  const html = `<html><body><h2>Quarterly</h2>
    <table><tr><th>Region</th><th>Won</th></tr><tr><td>Europe</td><td>575M</td></tr></table>
    <p>Wealth management leads.</p></body></html>`;
  const converted = await convertAttachmentToMarkdown({
    filename: "report.html",
    mime: "text/html",
    content: Buffer.from(html, "utf8"),
  });
  assert.ok(converted);
  assert.equal(converted.converter, "html");
  assert.match(converted.markdown, /## Quarterly/);
  assert.match(converted.markdown, /\| Region \| Won \|/);
  assert.match(converted.markdown, /Wealth management leads\./);
});

// ── docx (minimal OOXML built with fflate — the repo's own zip dep) ────────────────────────────────

function minimalDocx(paragraphs: string[]): Buffer {
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;
  const body = paragraphs
    .map((p) => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`)
    .join("");
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`;
  const zipped = zipSync({
    "[Content_Types].xml": strToU8(contentTypes),
    "_rels/.rels": strToU8(rels),
    "word/document.xml": strToU8(document),
  });
  return Buffer.from(zipped);
}

test("docx → markdown via mammoth (minimal OOXML)", async () => {
  const converted = await convertAttachmentToMarkdown({
    filename: "notes.docx",
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    content: minimalDocx(["Sales grew in Europe.", "Asia leads volume."]),
  });
  assert.ok(converted, "docx converts");
  assert.equal(converted.converter, "docx");
  assert.match(converted.markdown, /Sales grew in Europe\./);
  assert.match(converted.markdown, /Asia leads volume\./);
});

// ── failure honesty ────────────────────────────────────────────────────────────────────────────────

test("a corrupt document converts to undefined (raw-part behavior), never a throw", async () => {
  const garbage = Buffer.from("not really a pdf at all");
  const pdf = await convertAttachmentToMarkdown({
    filename: "broken.pdf",
    mime: "application/pdf",
    content: garbage,
  });
  assert.equal(pdf, undefined);
  const docx = await convertAttachmentToMarkdown({
    filename: "broken.docx",
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    content: garbage,
  });
  assert.equal(docx, undefined);
});

// ── content-part folding rules ─────────────────────────────────────────────────────────────────────

test("attachmentToContentParts: extracted markdown inlines; pdf keeps its raw part; docx does not", () => {
  const pdfParts = attachmentToContentParts({
    filename: "r.pdf",
    mime: "application/pdf",
    content: Buffer.from("%PDF-"),
    extractedText: "# Report\nEurope leads.",
  });
  assert.equal(pdfParts.length, 2, "pdf: markdown + raw file part for vision models");
  assert.equal(pdfParts[0]?.type, "text");
  assert.match((pdfParts[0] as { text: string }).text, /converted to markdown/);
  assert.match((pdfParts[0] as { text: string }).text, /Europe leads\./);
  assert.equal(pdfParts[1]?.type, "file");

  const docxParts = attachmentToContentParts({
    filename: "r.docx",
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    content: Buffer.from("PK"),
    extractedText: "Converted body.",
  });
  assert.equal(docxParts.length, 1, "docx: markdown only (no provider reads raw docx parts)");
  assert.equal(docxParts[0]?.type, "text");

  const rawBinary = attachmentToContentParts({
    filename: "r.bin",
    mime: "application/octet-stream",
    content: Buffer.from([1, 2, 3]),
  });
  assert.equal(rawBinary.length, 1);
  assert.equal(rawBinary[0]?.type, "file", "no extraction → pre-fix raw part");

  const textLike = attachmentToContentParts({
    filename: "notes.md",
    mime: "text/markdown",
    content: Buffer.from("# hi"),
  });
  assert.equal(textLike[0]?.type, "text", "text-like inlines raw, unchanged");
});
