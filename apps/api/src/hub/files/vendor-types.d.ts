// assistant-hub v1-fixes (attachment ingestion) — minimal ambient types for the two converter deps
// that ship no type definitions. Only the members the ingest module actually calls are declared.

declare module "mammoth" {
  export function convertToHtml(input: { buffer: Buffer }): Promise<{
    value: string;
    messages: Array<{ type: string; message: string }>;
  }>;
}

declare module "@joplin/turndown-plugin-gfm" {
  import type TurndownService from "turndown";
  export function gfm(service: TurndownService): void;
  export function tables(service: TurndownService): void;
  export function strikethrough(service: TurndownService): void;
}
