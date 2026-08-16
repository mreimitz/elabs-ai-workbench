import type { SkillManifest } from "@mcp-token-footprint/shared";
import { parse as parseYaml } from "yaml";

// Parse + validate `SKILL.md` frontmatter per the Agent Skills spec
// (research/skill-registry/01-agent-skills-format.md + schema/skill-manifest.schema.json).
//
// A malformed skill must STILL be storable so the inspector can surface broken artifacts — this
// function therefore NEVER throws: it always returns a best-effort `manifest` shape, a `valid`
// flag, and an itemized `errors` list. Callers persist `manifest_valid = valid ? 1 : 0` and
// `manifest_errors_json = errors`.

/** Result of parsing one `SKILL.md`: the (best-effort) manifest, validity, errors, and the body. */
export type ParsedSkillManifest = {
  manifest: SkillManifest;
  valid: boolean;
  errors: string[];
  /** The Markdown body after the frontmatter block (used for L2 token counting). */
  body: string;
};

/** Optional inputs that refine validation (e.g. the directory name a `name` mismatch warns against). */
export type ParseSkillManifestOptions = {
  /** Expected skill directory name; a mismatch with `name` produces a WARNING (not a failure). */
  expectedDirName?: string;
};

// Spec constraints (01-agent-skills-format.md, skill-manifest.schema.json).
const NAME_MAX = 64;
const DESCRIPTION_MAX = 1024;
const COMPATIBILITY_MAX = 500;
// lowercase a–z / 0–9, single hyphens, no leading/trailing/consecutive hyphens.
const NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
// Reserved words on Anthropic surfaces.
const RESERVED_WORDS = ["anthropic", "claude"] as const;
// A crude XML/HTML-tag detector: `<...>` with a tag-like start. Enough to reject embedded markup.
const XML_TAG_PATTERN = /<\/?[a-zA-Z][^>]*>/;

/**
 * Parse and validate a `SKILL.md` document. Never throws — a malformed document yields
 * `valid: false` with itemized `errors` so it can still be stored and inspected.
 */
export function parseSkillManifest(
  text: string,
  options: ParseSkillManifestOptions = {},
): ParsedSkillManifest {
  const errors: string[] = [];
  const { frontmatter, body, hadFrontmatter } = splitFrontmatter(text);

  if (!hadFrontmatter) {
    errors.push("Missing YAML frontmatter (expected a leading '---' delimited block).");
  }

  let raw: Record<string, unknown> = {};
  if (hadFrontmatter) {
    try {
      const parsed = parseYaml(frontmatter);
      if (parsed === null || parsed === undefined) {
        // Empty frontmatter block — treated as no fields (required-field errors follow).
        raw = {};
      } else if (typeof parsed === "object" && !Array.isArray(parsed)) {
        raw = parsed as Record<string, unknown>;
      } else {
        errors.push("Frontmatter must be a YAML mapping of fields.");
      }
    } catch (err) {
      errors.push(`Frontmatter is not valid YAML: ${(err as Error).message}`);
    }
  }

  const manifest = buildManifest(raw);

  validateName(manifest.name, raw.name, errors);
  validateDescription(manifest.description, raw.description, errors);
  validateOptionalFields(manifest, raw, errors);

  // `name !== dir` is a WARNING, not a hard failure — the version is still storable.
  if (options.expectedDirName && manifest.name && manifest.name !== options.expectedDirName) {
    errors.push(
      `Warning: name "${manifest.name}" does not match the skill directory name "${options.expectedDirName}".`,
    );
  }

  // Only hard errors (not warnings) flip validity. Warnings are prefixed "Warning:".
  const valid = errors.every((e) => e.startsWith("Warning:"));

  return { manifest, valid, errors, body };
}

/** Split a leading `---`-delimited YAML frontmatter block from the Markdown body. */
function splitFrontmatter(text: string): {
  frontmatter: string;
  body: string;
  hadFrontmatter: boolean;
} {
  // Normalize CRLF so the delimiter regex is line-based regardless of platform.
  const normalized = text.replace(/\r\n/g, "\n");
  // Frontmatter must be at the very start (optionally after a BOM). Opening `---` on its own line,
  // closing `---` on its own line.
  const withoutBom = normalized.replace(/^﻿/, "");
  const match = withoutBom.match(/^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n([\s\S]*))?$/);
  if (!match) {
    return { frontmatter: "", body: withoutBom, hadFrontmatter: false };
  }
  return {
    frontmatter: match[1] ?? "",
    body: (match[2] ?? "").replace(/^\n/, ""),
    hadFrontmatter: true,
  };
}

/** Coerce the parsed YAML object into the `SkillManifest` shape (lenient — validation is separate). */
function buildManifest(raw: Record<string, unknown>): SkillManifest {
  const manifest: SkillManifest = {
    name: typeof raw.name === "string" ? raw.name : "",
    description: typeof raw.description === "string" ? raw.description : "",
  };

  if (typeof raw.license === "string") manifest.license = raw.license;
  if (typeof raw.compatibility === "string") manifest.compatibility = raw.compatibility;

  const metadata = coerceStringMap(raw.metadata);
  if (metadata) manifest.metadata = metadata;

  // The spec field is `allowed-tools`; we also accept `allowedTools` for tolerance. Kept as the
  // raw space-separated string per the contract.
  const allowedTools = raw["allowed-tools"] ?? raw.allowedTools;
  if (typeof allowedTools === "string") manifest.allowedTools = allowedTools;

  // Skill IDE WP 8.1 (I9.1) — the portable server-binding list. Parsed like `keywords:`: a scalar
  // string OR a list, order-preserving, trimmed, deduped, empties dropped. Tolerated metadata: absent
  // ⇒ no `servers` field (never an error — validation stays unchanged).
  const servers = coerceStringList(raw.servers);
  if (servers) manifest.servers = servers;

  return manifest;
}

/**
 * Coerce a YAML `servers:` value (scalar string or list) into an order-preserving, trimmed, deduped
 * list of non-empty names. Returns undefined when there is nothing usable (absent / non-string
 * entries only) so an absent `servers:` leaves the manifest field unset.
 */
function coerceStringList(value: unknown): string[] | undefined {
  const raw: unknown[] = typeof value === "string" ? [value] : Array.isArray(value) ? value : [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (typeof entry !== "string") continue;
    const name = entry.trim();
    if (name === "" || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out.length > 0 ? out : undefined;
}

/** Coerce a YAML mapping into a `Record<string, string>`; non-string scalars are stringified. */
function coerceStringMap(value: unknown): Record<string, string> | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) return undefined;
  const out: Record<string, string> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (v === null || v === undefined) continue;
    out[key] = typeof v === "string" ? v : String(v);
  }
  return out;
}

function validateName(name: string, rawName: unknown, errors: string[]): void {
  if (rawName === undefined) {
    errors.push("Missing required field: name.");
    return;
  }
  if (typeof rawName !== "string") {
    errors.push("Field 'name' must be a string.");
    return;
  }
  if (name.length < 1 || name.length > NAME_MAX) {
    errors.push(`Field 'name' must be 1–${NAME_MAX} characters (got ${name.length}).`);
  }
  if (XML_TAG_PATTERN.test(name)) {
    errors.push("Field 'name' must not contain XML/HTML tags.");
  }
  if (name.length > 0 && !NAME_PATTERN.test(name)) {
    errors.push(
      "Field 'name' must be lowercase letters, digits, and single hyphens (no leading/trailing/consecutive hyphens).",
    );
  }
  const lower = name.toLowerCase();
  for (const reserved of RESERVED_WORDS) {
    if (lower.includes(reserved)) {
      errors.push(`Field 'name' must not contain the reserved word "${reserved}".`);
    }
  }
}

function validateDescription(description: string, rawDescription: unknown, errors: string[]): void {
  if (rawDescription === undefined) {
    errors.push("Missing required field: description.");
    return;
  }
  if (typeof rawDescription !== "string") {
    errors.push("Field 'description' must be a string.");
    return;
  }
  if (description.length < 1) {
    errors.push("Field 'description' must be non-empty.");
  }
  if (description.length > DESCRIPTION_MAX) {
    errors.push(
      `Field 'description' must be at most ${DESCRIPTION_MAX} characters (got ${description.length}).`,
    );
  }
  if (XML_TAG_PATTERN.test(description)) {
    errors.push("Field 'description' must not contain XML/HTML tags.");
  }
}

function validateOptionalFields(
  manifest: SkillManifest,
  raw: Record<string, unknown>,
  errors: string[],
): void {
  if (raw.license !== undefined && typeof raw.license !== "string") {
    errors.push("Field 'license' must be a string.");
  }
  if (raw.compatibility !== undefined) {
    if (typeof raw.compatibility !== "string") {
      errors.push("Field 'compatibility' must be a string.");
    } else if (raw.compatibility.length > COMPATIBILITY_MAX) {
      errors.push(
        `Field 'compatibility' must be at most ${COMPATIBILITY_MAX} characters (got ${raw.compatibility.length}).`,
      );
    }
  }
  if (
    raw.metadata !== undefined &&
    (typeof raw.metadata !== "object" || Array.isArray(raw.metadata))
  ) {
    errors.push("Field 'metadata' must be a string→string map.");
  }
  const allowedTools = raw["allowed-tools"] ?? raw.allowedTools;
  if (allowedTools !== undefined && typeof allowedTools !== "string") {
    errors.push("Field 'allowed-tools' must be a space-separated string.");
  }
}
