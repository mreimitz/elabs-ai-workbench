#!/usr/bin/env node
/**
 * build-docs-bundle.mjs — RM-18 WP 1.2, the build-time docs bundle.
 * =================================================================================================
 *
 * WHAT IT DOES
 *   Reads the shipped user guide (`planning/user-guide/DC-*`) plus the repo `CHANGELOG.md`, and
 *   writes a static, self-describing bundle into `apps/web/public/doc-content/`:
 *
 *     doc-content/manifest.json           the table of contents (subjects → documents)
 *     doc-content/<subject>/<doc>.md      one Markdown body per shipped document
 *     doc-content/<subject>/images/…      the assets those documents reference
 *     doc-content/changelog.md            the repo CHANGELOG, body only
 *
 *   Vite copies `apps/web/public/**` into `apps/web/dist/` verbatim, and the runtime image copies
 *   `apps/web/dist`. That is the whole reason this runs at BUILD time: the runtime stage of the
 *   Dockerfile carries only the three `dist` folders (Dockerfile:83-85), so `planning/` is not on
 *   disk when the container serves the app and no API route could read it even if one existed.
 *
 * WHAT IT SHIPS, AND WHY THAT RULE IS STRUCTURAL
 *   A document is shipped if — and only if — its OKF frontmatter says `type: "Guide Page"`. That is
 *   the bundle's OWN declaration of "this is a page of the manual" (`planning/.claude/okf-profile.json`
 *   registers `Guide Page` as a first-class concept type), so the selection rule is a property of the
 *   document rather than a filename blacklist that drifts.
 *
 *   It follows, without a second rule, that `doc.md` never ships: `doc.md` is `type: "Documentation"`
 *   — the DELIVERY RECORD, what shipped versus what was planned, written for whoever maintains the
 *   project rather than for the operator running it. `index.md` and `log.md` carry no frontmatter at
 *   all, so they are not concepts and never ship either.
 *
 * WHAT IT REFUSES TO DO
 *   - Emit an empty bundle. Zero subjects, or a subject with zero shipped documents, is a hard
 *     failure: a silently empty docs section is worse than a build error. A subject entry in the
 *     manifest cannot spell "no documents".
 *   - Emit a subject whose id collides with the reserved `changelog` id (the `/docs/changelog`
 *     route), or with another subject's id.
 *
 * DETERMINISM
 *   The same input tree produces byte-identical output: subjects are ordered by DC tag, documents by
 *   filename, and nothing in the manifest is a timestamp, a hostname or a random id. A rebuild that
 *   changes nothing changes no bytes.
 *
 * OUTPUT PATH — `/doc-content/`, deliberately NOT `/docs/`
 *   `/docs/*` is the CLIENT ROUTE. The API serves `apps/web/dist` at prefix `/` with an SPA
 *   not-found fallback, so a static directory named `docs/` would race the route for URLs like
 *   `/docs/manifest.json`. Two different names removes the question entirely; `docs-collision.test.ts`
 *   pins it.
 *
 * BUILD-CONTEXT DEPENDENCY (read this before editing `.dockerignore`)
 *   The Docker build stage runs `pnpm build`, which runs this script, which reads `planning/`.
 *   `.dockerignore` currently excludes `docs/`, `.claude/`, and the two legacy `research/`+`roadmap/`
 *   trees — but NOT `planning/`. Excluding `planning/` would make this script find zero subjects and
 *   fail the image build loudly, which is the intended failure mode, not a silent empty guide.
 *
 * USAGE
 *   node scripts/build-docs-bundle.mjs            # writes apps/web/public/doc-content/
 *   node scripts/build-docs-bundle.mjs --quiet    # same, without the summary line
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, posix, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** The one manifest schema version. Bump only on a breaking shape change (the reader checks it). */
export const DOCS_MANIFEST_SCHEMA = 1;

/** The subject id reserved for `/docs/changelog`; no DC subject may claim it. */
export const RESERVED_SUBJECT_ID = "changelog";

/** The OKF concept type that marks a document as a page of the shipped user guide. */
const GUIDE_PAGE_TYPE = "Guide Page";

/** `DC-07-skills` → tag `DC-07`, id `skills`. */
const SUBJECT_DIR_RE = /^(DC-(\d{2}))-(.+)$/;

// ── Frontmatter ───────────────────────────────────────────────────────────────────────────────────

/**
 * Split an OKF concept into its frontmatter fields and its Markdown body.
 *
 * Deliberately NOT a general YAML parser: OKF frontmatter is a flat block of `key: value` lines that
 * the generator writes, and the values that matter here (`type`, `title`, `description`) are emitted
 * as JSON strings (which is how `—`-style escapes survive a round trip). A quoted value is
 * therefore parsed with `JSON.parse`; anything else is taken literally. A file with no frontmatter
 * yields no fields — which is exactly how `index.md` / `log.md` fall out of the shipped set.
 */
export function parseFrontmatter(source) {
  if (!source.startsWith("---")) return { fields: {}, body: source };
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(source);
  if (!match) return { fields: {}, body: source };
  const fields = {};
  for (const line of (match[1] ?? "").split(/\r?\n/)) {
    const pair = /^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/.exec(line);
    if (!pair) continue;
    const key = pair[1];
    const raw = (pair[2] ?? "").trim();
    if (raw.startsWith('"')) {
      try {
        fields[key] = JSON.parse(raw);
        continue;
      } catch {
        // fall through to the literal reading below
      }
    }
    fields[key] = raw;
  }
  return { fields, body: source.slice(match[0].length).replace(/^\s*\n/, "") };
}

// ── Link rewriting ────────────────────────────────────────────────────────────────────────────────

/**
 * Rewrite a repo-relative Markdown link so it resolves INSIDE the running app.
 *
 * The guide cross-references itself ~130 times (`../DC-08-testing-console/09-testing.md`,
 * `./02-getting-started.md`) and DC-23 embeds 36 screenshots. Shipped verbatim, every one of those
 * would be a dead link in the app, so each target is resolved against the shipped set:
 *
 *   - a link to a shipped guide page  → `/docs/<subjectId>#<docId>` (a subject renders all of its
 *     documents on one page, so the document id is the anchor; the original `#fragment` is dropped
 *     because heading anchors are not generated)
 *   - a link to a shipped asset       → `/doc-content/<subjectId>/images/…`
 *   - anything else (an absolute URL, a bundle-root `/Roadmap/…` link, a repository file) → left
 *     EXACTLY as written and counted, so the number of links the app cannot resolve is a measured
 *     number rather than an assumption.
 *
 * Pure: everything it needs about the shipped set arrives in `index`.
 */
export function rewriteLink(target, context) {
  const trimmed = target.trim();
  if (trimmed.length === 0) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) || trimmed.startsWith("#") || trimmed.startsWith("//")) {
    return null;
  }
  // A bundle-root link (`/Roadmap/…`) names a path in the planning bundle, not in the app.
  if (trimmed.startsWith("/")) return null;

  const [pathPart] = trimmed.split("#");
  if (!pathPart) return null;
  // Resolve against the document's own subject directory, inside `planning/user-guide`.
  const resolved = posix.normalize(posix.join(context.subjectDir, pathPart));
  if (resolved.startsWith("..")) return null;

  const document = context.index.documentsByPath.get(resolved);
  if (document) return `/docs/${document.subjectId}#${document.documentId}`;

  const asset = context.index.assetsByPath.get(resolved);
  if (asset) return `/doc-content/${asset}`;

  return null;
}

/**
 * Apply {@link rewriteLink} to every inline Markdown link/image target in `markdown`, skipping
 * fenced code blocks so a `](…)` inside an example is never rewritten. Returns the new body plus the
 * count of targets left untouched because nothing in the shipped bundle answers them.
 */
export function rewriteLinks(markdown, context) {
  const lines = markdown.split("\n");
  let inFence = false;
  let unresolved = 0;
  const out = lines.map((line) => {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      return line;
    }
    if (inFence) return line;
    return line.replace(/\]\(([^)\s]+)(\s+"[^"]*")?\)/g, (whole, target, title) => {
      const next = rewriteLink(target, context);
      if (next === null) {
        if (!/^[a-z][a-z0-9+.-]*:/i.test(target) && !target.startsWith("#")) unresolved += 1;
        return whole;
      }
      return `](${next}${title ?? ""})`;
    });
  });
  return { markdown: out.join("\n"), unresolved };
}

// ── Reading the guide ─────────────────────────────────────────────────────────────────────────────

/**
 * Read `planning/user-guide` into the shipped set: every `DC-NN-slug` subject that has at least one
 * `type: "Guide Page"` document, in DC order, each document in filename order.
 *
 * Throws — loudly, with the directory it looked in — rather than returning an empty set. The two
 * refusals the WP names (`changelog` collision, zero subjects) live here, alongside the duplicate-id
 * refusal they imply.
 */
export function collectSubjects(userGuideDir) {
  if (!existsSync(userGuideDir)) {
    throw new Error(`build-docs-bundle: user guide directory not found: ${userGuideDir}`);
  }
  const subjects = [];
  const dirNames = readdirSync(userGuideDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && SUBJECT_DIR_RE.test(entry.name))
    .map((entry) => entry.name)
    .sort();

  for (const dirName of dirNames) {
    const parts = SUBJECT_DIR_RE.exec(dirName);
    if (!parts) continue;
    const [, tag, , slug] = parts;
    const subjectPath = join(userGuideDir, dirName);

    const documents = [];
    for (const fileName of readdirSync(subjectPath).sort()) {
      if (!fileName.endsWith(".md")) continue;
      const source = readFileSync(join(subjectPath, fileName), "utf8");
      const { fields, body } = parseFrontmatter(source);
      if (fields.type !== GUIDE_PAGE_TYPE) continue;
      documents.push({
        id: fileName.slice(0, -3),
        title: typeof fields.title === "string" && fields.title.length > 0 ? fields.title : fileName,
        description: typeof fields.description === "string" ? fields.description : "",
        fileName,
        body,
      });
    }
    // A subject with no guide page has nothing an operator could read. It is left OUT of the
    // manifest rather than rendered as a blank page — see `skipped` in the build summary.
    if (documents.length === 0) {
      subjects.push({ id: slug, tag, dirName, skipped: true });
      continue;
    }

    const docSource = join(subjectPath, "doc.md");
    const subjectFields = existsSync(docSource)
      ? parseFrontmatter(readFileSync(docSource, "utf8")).fields
      : {};

    subjects.push({
      id: slug,
      tag,
      dirName,
      skipped: false,
      title:
        typeof subjectFields.title === "string" && subjectFields.title.length > 0
          ? subjectFields.title
          : slug,
      description: typeof subjectFields.description === "string" ? subjectFields.description : "",
      documents,
      assetDirs: readdirSync(subjectPath, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort(),
    });
  }

  const shipped = subjects.filter((subject) => !subject.skipped);

  if (shipped.length === 0) {
    throw new Error(
      `build-docs-bundle: found 0 shipped documentation subjects under ${userGuideDir}. ` +
        `A subject ships when it holds at least one document with OKF frontmatter type "${GUIDE_PAGE_TYPE}". ` +
        "Refusing to write an empty docs bundle — an empty docs section is worse than a build error.",
    );
  }

  const seen = new Map();
  for (const subject of shipped) {
    if (subject.id === RESERVED_SUBJECT_ID) {
      throw new Error(
        `build-docs-bundle: ${subject.dirName} would take the subject id "${RESERVED_SUBJECT_ID}", ` +
          "which is reserved for the repository CHANGELOG at /docs/changelog. Rename the subject slug.",
      );
    }
    const previous = seen.get(subject.id);
    if (previous) {
      throw new Error(
        `build-docs-bundle: ${previous} and ${subject.dirName} both resolve to the subject id ` +
          `"${subject.id}" — /docs/${subject.id} could only show one of them. Rename one slug.`,
      );
    }
    seen.set(subject.id, subject.dirName);
  }

  return subjects;
}

/** The lookup {@link rewriteLink} resolves against: repo-relative path → shipped document / asset. */
function buildIndex(subjects, userGuideDir) {
  const documentsByPath = new Map();
  const assetsByPath = new Map();
  for (const subject of subjects) {
    if (subject.skipped) continue;
    for (const document of subject.documents) {
      documentsByPath.set(`${subject.dirName}/${document.fileName}`, {
        subjectId: subject.id,
        documentId: document.id,
      });
    }
    for (const assetDir of subject.assetDirs) {
      for (const file of walkFiles(join(userGuideDir, subject.dirName, assetDir))) {
        assetsByPath.set(`${subject.dirName}/${assetDir}/${file}`, `${subject.id}/${assetDir}/${file}`);
      }
    }
  }
  return { documentsByPath, assetsByPath };
}

/** Every file under `root`, as posix-relative paths, sorted (determinism). */
function walkFiles(root) {
  if (!existsSync(root)) return [];
  const out = [];
  const visit = (dir, prefix) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    )) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) visit(join(dir, entry.name), relative);
      else out.push(relative);
    }
  };
  visit(root, "");
  return out;
}

// ── The build ─────────────────────────────────────────────────────────────────────────────────────

/**
 * Build the bundle. Returns the manifest it wrote plus the counts a caller (the CLI, the test) can
 * assert on. `repoRoot` and `outDir` are parameters so the test drives it over a fixture tree
 * instead of the real repository.
 */
export function buildDocsBundle({ repoRoot, outDir }) {
  const userGuideDir = join(repoRoot, "planning", "user-guide");
  const changelogPath = join(repoRoot, "CHANGELOG.md");
  if (!existsSync(changelogPath)) {
    throw new Error(`build-docs-bundle: CHANGELOG.md not found at ${changelogPath}`);
  }

  const subjects = collectSubjects(userGuideDir);
  const index = buildIndex(subjects, userGuideDir);

  // Rewritten from scratch every run so a deleted subject cannot linger in a stale bundle.
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  let unresolvedLinks = 0;
  let assetCount = 0;
  const manifestSubjects = [];

  for (const subject of subjects) {
    if (subject.skipped) continue;
    const documents = [];
    for (const document of subject.documents) {
      const rewritten = rewriteLinks(document.body, {
        subjectDir: subject.dirName,
        index,
      });
      unresolvedLinks += rewritten.unresolved;
      const relativePath = `${subject.id}/${document.id}.md`;
      writeOut(outDir, relativePath, rewritten.markdown);
      documents.push({
        id: document.id,
        title: document.title,
        description: document.description,
        path: relativePath,
      });
    }
    for (const assetDir of subject.assetDirs) {
      const from = join(userGuideDir, subject.dirName, assetDir);
      const to = join(outDir, subject.id, assetDir);
      const files = walkFiles(from);
      if (files.length === 0) continue;
      mkdirSync(dirname(to), { recursive: true });
      cpSync(from, to, { recursive: true });
      assetCount += files.length;
    }
    manifestSubjects.push({
      id: subject.id,
      tag: subject.tag,
      title: subject.title,
      description: subject.description,
      documents,
    });
  }

  const changelogSource = readFileSync(changelogPath, "utf8");
  writeOut(outDir, "changelog.md", parseFrontmatter(changelogSource).body);

  const manifest = {
    schema: DOCS_MANIFEST_SCHEMA,
    subjects: manifestSubjects,
    changelog: { id: RESERVED_SUBJECT_ID, title: "Changelog", path: "changelog.md" },
  };
  writeOut(outDir, "manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);

  return {
    manifest,
    outDir,
    documentCount: manifestSubjects.reduce((sum, subject) => sum + subject.documents.length, 0),
    assetCount,
    unresolvedLinks,
    skipped: subjects.filter((subject) => subject.skipped).map((subject) => subject.dirName),
  };
}

function writeOut(outDir, relativePath, contents) {
  const target = join(outDir, relativePath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, contents, "utf8");
}

// ── CLI ───────────────────────────────────────────────────────────────────────────────────────────

// Node's ESM loader resolves symlinks, so `import.meta.url` is the REAL path while `process.argv[1]`
// is whatever the caller typed. On macOS `os.tmpdir()` is itself a symlink (`/var` → `/private/var`),
// so comparing the two verbatim silently reports "not the entry point" and the CLI never runs — which
// is exactly how a test that copies this script into a temp directory would pass against a script
// that did nothing. Compare real paths.
const isDirectRun = (() => {
  const invoked = process.argv[1];
  if (invoked === undefined) return false;
  try {
    return pathToFileURL(realpathSync(invoked)).href === import.meta.url;
  } catch {
    return pathToFileURL(invoked).href === import.meta.url;
  }
})();

if (isDirectRun) {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const outDir = join(repoRoot, "apps", "web", "public", "doc-content");
  const result = buildDocsBundle({ repoRoot, outDir });
  if (!process.argv.includes("--quiet")) {
    const skipped =
      result.skipped.length > 0 ? ` · no guide page yet: ${result.skipped.join(", ")}` : "";
    const dead =
      result.unresolvedLinks > 0 ? ` · ${result.unresolvedLinks} link(s) outside the bundle` : "";
    console.log(
      `docs bundle: ${result.manifest.subjects.length} subjects · ${result.documentCount} documents · ` +
        `${result.assetCount} assets${dead}${skipped}`,
    );
  }
}
