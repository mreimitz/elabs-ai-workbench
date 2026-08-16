import { afterEach, describe, expect, test, vi } from "vitest";
import { downloadCsv, toCsv } from "./csv";

/**
 * WP 6.1 — the client-side CSV export helpers behind the answer tables' "download" affordance.
 * `toCsv` is a pure serializer (escaping is the whole risk surface); `downloadCsv` is the DOM
 * side-effect (assert it wires a blob → object-URL → anchor click → revoke, with the DOM bits stubbed).
 */

describe("toCsv", () => {
  test("plain cells need no quoting", () => {
    expect(toCsv(["Carrier", "Flights"], [["AA", 100], ["UA", 250]])).toBe(
      "Carrier,Flights\r\nAA,100\r\nUA,250",
    );
  });

  test("a cell containing a comma is quoted", () => {
    expect(toCsv(["Asset", "Glossary"], [["Carrier", "airline, carrier"]])).toBe(
      'Asset,Glossary\r\nCarrier,"airline, carrier"',
    );
  });

  test("a cell containing a double-quote is quoted and its quotes doubled", () => {
    expect(toCsv(["Note"], [['She said "hi"']])).toBe('Note\r\n"She said ""hi"""');
  });

  test("a cell containing a newline is quoted", () => {
    expect(toCsv(["Note"], [["line one\nline two"]])).toBe('Note\r\n"line one\nline two"');
  });

  test("a cell containing a carriage return is quoted", () => {
    expect(toCsv(["Note"], [["a\rb"]])).toBe('Note\r\n"a\rb"');
  });

  test("numbers serialize without locale grouping (re-imports cleanly)", () => {
    expect(toCsv(["N"], [[1234567.5]])).toBe("N\r\n1234567.5");
  });

  test("no rows → just the header line", () => {
    expect(toCsv(["A", "B"], [])).toBe("A,B");
  });

  test("a ragged (short) row emits fewer cells and never throws", () => {
    expect(toCsv(["A", "B", "C"], [["x"]])).toBe("A,B,C\r\nx");
  });
});

describe("downloadCsv", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("wires a blob → object-URL → anchor click → revoke", () => {
    // jsdom implements neither URL.createObjectURL nor revokeObjectURL — install stubs to spy on.
    const createUrl = vi.fn().mockReturnValue("blob:fake-url");
    const revokeUrl = vi.fn();
    (URL as unknown as { createObjectURL: unknown }).createObjectURL = createUrl;
    (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = revokeUrl;
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    downloadCsv("carriers.csv", "A,B\r\n1,2");

    expect(createUrl).toHaveBeenCalledTimes(1);
    const blob = createUrl.mock.calls[0]?.[0] as Blob;
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toContain("text/csv");
    expect(click).toHaveBeenCalledTimes(1);
    // The clicked anchor carried the requested filename + the object URL.
    const anchor = click.mock.instances[0] as unknown as HTMLAnchorElement;
    expect(anchor.download).toBe("carriers.csv");
    expect(anchor.getAttribute("href")).toBe("blob:fake-url");
    // The transient URL is revoked (no leak).
    expect(revokeUrl).toHaveBeenCalledWith("blob:fake-url");
    // The anchor is not left in the document.
    expect(document.querySelector("a[download]")).toBeNull();
  });
});
