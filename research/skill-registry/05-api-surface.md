# 05 — API surface & shared contract

Contract-first: add types + zod to `packages/shared` **first**, then the API, then the web. Routes
are additive under `/api` (versionless MVP convention). New plugin registered in
`apps/api/src/index.ts` as `await registerSkillRoutes(server, skills, skillIngest, gitService)`.

## Shared types (`packages/shared/src/types.ts`)

```ts
export type SkillSourceType = 'upload' | 'github';

export type SkillManifest = {
  name: string;
  description: string;
  license?: string;
  compatibility?: string;
  metadata?: Record<string, string>;
  allowedTools?: string;          // raw space-separated string, per spec
};

// api → web (redacted: no PAT, only a boolean)
export type Skill = {
  id: string;
  name: string;
  displayName: string;
  slug: string;
  sourceType: SkillSourceType;
  description?: string;
  currentVersionId?: string;
  versionCount: number;
  // GitHub binding (present when sourceType === 'github'):
  github?: { repoUrl: string; ref: string; subpath: string; lastSha?: string; hasAuth: boolean };
  createdAt: string;
  updatedAt: string;
};

export type SkillTokenFootprint = {
  tokenProfile: TokenProfileId;
  l1MetadataTokens: number;
  l2BodyTokens: number;
  l3ResourceTokens: number;
  totalTokens: number;
};

export type SkillVersion = SkillTokenFootprint & {
  id: string;
  skillId: string;
  seq: number;
  versionLabel: string;
  treeSha: string;
  sourceKind: SkillSourceType;
  sourceRef?: string;
  manifest: SkillManifest;
  manifestValid: boolean;
  manifestErrors: string[];
  fileCount: number;
  totalBytes: number;
  importedFrom: 'upload' | 'github-pull';
  note?: string;
  createdAt: string;
};

export type SkillFileNode = {
  path: string;              // posix, relative to skill root
  size: number;
  isBinary: boolean;
  isSkillMd: boolean;
  kind: 'skill_md' | 'reference' | 'script' | 'asset' | 'other';
  tokenTotal: number;
};

export type SkillFileContent =
  | { path: string; isBinary: false; text: string; tokenTotal: number }
  | { path: string; isBinary: true;  size: number; downloadPath: string };

export type SkillDiffEntry = {
  status: 'added' | 'removed' | 'modified' | 'renamed' | 'unchanged';
  path: string;
  fromPath?: string;         // for renames
  kind: SkillFileNode['kind'];
  fromTokens?: number;
  toTokens?: number;
  tokenDelta: number;
  binary: boolean;
};

export type SkillDiff = {
  skillId: string;
  fromVersionId: string;
  toVersionId: string;
  entries: SkillDiffEntry[];
  rollup: {
    filesAdded: number; filesRemoved: number; filesModified: number; filesRenamed: number;
    bytesDelta: number;
    l1Delta: number; l2Delta: number; l3Delta: number; totalDelta: number;
  };
  manifestDiff: { field: string; from?: string; to?: string }[];
};

// GitHub discovery (probe) result — which SKILL.md dirs a repo/ref exposes.
export type SkillRepoProbe = {
  repoUrl: string;
  ref: string;
  ok: boolean;
  requiresAuth: boolean;
  commitSha?: string;
  candidates: { subpath: string; name?: string; description?: string }[];  // one per SKILL.md found
  message: string;
  errorMessage?: string;
};
```

## Shared zod (`packages/shared/src/schemas.ts`)

```ts
export const githubImportSchema = z.object({
  source: z.literal('github'),
  repoUrl: z.string().trim().url(),
  ref: z.string().trim().min(1).default('main'),
  subpath: z.string().trim().default(''),          // '' = repo root; else the chosen skill dir
  auth: z.object({ token: z.string().min(1) }).optional(),   // PAT for private repos
  displayName: z.string().trim().optional()
});

// Upload metadata travels as multipart fields alongside the file part.
export const uploadImportSchema = z.object({
  source: z.literal('upload'),
  displayName: z.string().trim().optional()
});

export const skillImportSchema = z.discriminatedUnion('source', [githubImportSchema, uploadImportSchema]);

export const skillUpdateSchema = z.object({
  displayName: z.string().trim().min(1).optional(),
  github: z.object({ ref: z.string().trim().min(1).optional(),
                     auth: z.object({ token: z.string().min(1) }).nullable().optional() }).optional()
});

export const skillRepoProbeSchema = z.object({
  repoUrl: z.string().trim().url(),
  ref: z.string().trim().min(1).default('main'),
  auth: z.object({ token: z.string().min(1) }).optional()
});
```

## Routes (`apps/api/src/skills/routes.ts`)

| Method & path | Body / query | Returns | Notes |
|---|---|---|---|
| `GET /api/skills` | — | `Skill[]` | list, newest first |
| `POST /api/skills/probe` | `skillRepoProbeSchema` | `SkillRepoProbe` | discover SKILL.md dirs in a repo/ref (no persistence) |
| `POST /api/skills` | multipart (`file` + `skillImportSchema` fields) **or** JSON `githubImportSchema` | `Skill` (201) | create skill + v1; upload uses multipart, GitHub uses JSON |
| `GET /api/skills/:id` | — | `Skill` | redacted (PAT → `hasAuth`) |
| `PUT /api/skills/:id` | `skillUpdateSchema` | `Skill` | rename, retarget ref, set/clear PAT |
| `DELETE /api/skills/:id` | — | 204 | cascades versions/files; GCs blobs |
| `GET /api/skills/:id/versions` | — | `SkillVersion[]` | ordered by `seq DESC` |
| `POST /api/skills/:id/versions` | multipart file (upload skills) | `SkillVersion` (201) or `{ unchanged: true }` | add a new uploaded version |
| `POST /api/skills/:id/pull` | — | `SkillVersion` (201) or `{ unchanged: true }` | GitHub: fetch+diff+maybe-new-version |
| `GET /api/skills/:id/upstream` | — | `{ hasUpdate: boolean; upstreamSha?: string }` | GitHub: `git ls-remote` (no clone) for the update badge |
| `GET /api/skills/:id/versions/:vid/export` | — | `.zip` bytes | rebuild the exact tree from blobs; `content-disposition: attachment` |
| `GET /api/skills/:id/versions/:vid` | — | `SkillVersion` | one version detail |
| `GET /api/skills/:id/versions/:vid/files` | — | `SkillFileNode[]` | flat list; UI builds the tree |
| `GET /api/skills/:id/versions/:vid/file?path=` | query `path` | `SkillFileContent` | text inline; binary → `downloadPath` |
| `GET /api/skills/:id/versions/:vid/raw?path=` | query `path` | bytes (+ content-type) | binary/asset download & preview |
| `GET /api/skills/:id/diff?from=&to=` | query `from`,`to` (version ids) | `SkillDiff` | full-tree diff + rollup + manifest diff |
| `GET /api/skills/:id/diff/file?from=&to=&path=` | query | `{ path, from: SkillFileContent, to: SkillFileContent }` | feeds Monaco `DiffEditor` |

### Web api client (`apps/web/src/lib/api.ts`)

Thin wrappers as usual: `listSkills()`, `probeSkillRepo(input)`, `getSkill(id)`, `updateSkill`,
`deleteSkill`, `listSkillVersions(id)`, `pullSkill(id)`, `getSkillFiles(id,vid)`,
`getSkillFile(id,vid,path)`, `getSkillDiff(id,from,to)`, `getSkillFileDiff(id,from,to,path)`.
**Uploads** can't use `apiPost` (JSON) — add a small `apiUpload(path, file, fields)` helper that
builds a `FormData` and `fetch`es it, reusing `readResponse`/`raiseResponseError` for parity.

## Fastify wiring notes

- Register `@fastify/multipart` (new dep — see [`06`](./06-ingestion-and-github.md)) so
  `POST /api/skills` and `/versions` can accept a file part with a size limit
  (`SKILL_MAX_TOTAL_BYTES`).
- Error handling is unchanged: throw `ZodError` (→400) or typed errors with `statusCode`; the
  central handler in `index.ts` formats them. Ingest failures (bad zip, no SKILL.md, invalid
  frontmatter) throw a 400 with a clear message surfaced as a toast.
