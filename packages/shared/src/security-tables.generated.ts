// GENERATED — do not edit by hand.
// Source of truth: data-pack/security/{rules,signatures}.json; regenerate with `pnpm build:data-pack`.
//
// This module imports NOTHING, at runtime or as a type. It is the bundled snapshot of the pack's
// security tables: the fallback for consumers that cannot read a pack off disk (the browser
// bundle), and the reference a candidate pack's rule ledger and severities are checked against
// (RM-38 D-DP6/D-DP7). `packages/shared/src/security-tables.ts` is what reads it.

/** The analyzer version the BUNDLED rules were declared at. A pack may carry a greater one. */
export const BUNDLED_SECURITY_ANALYZER_VERSION = 4;

/** Every rule id ever shipped. Append-only: a pack that drops or renames one is refused. */
export const BUNDLED_SECURITY_RULE_ID_LEDGER = [
  "poisoning.injection-phrasing",
  "poisoning.hidden-instructions",
  "poisoning.invisible-unicode",
  "poisoning.oversized-description",
  "annotation.destructive-unmarked",
  "annotation.readonly-contradiction",
  "annotation.open-world-unmarked",
  "schema.secret-shaped-parameter",
  "schema.undescribed-parameter",
  "schema.unconstrained-additional-properties",
  "oauth.broad-scope",
  "skill-surface.injection-phrasing",
  "skill-surface.hidden-instructions",
  "skill-surface.invisible-unicode",
  "skill-surface.credential-in-body",
  "skill-surface.broad-allowed-tools",
  "skill-surface.executable-scripts",
  "skill-surface.network-reference"
] as const;

/** The rule registry, keyed by id, in declaration order. */
export const BUNDLED_SECURITY_RULES = {
  "poisoning.injection-phrasing": {
    "id": "poisoning.injection-phrasing",
    "category": "poisoning",
    "subject": "server",
    "severity": "error",
    "title": "Injection phrasing in description",
    "rationale": "The description tells the model to override its own instructions or to keep something from you. A tool definition is prompt text the model reads verbatim, so this steers every session that loads the server — treat it as hostile until the vendor explains it."
  },
  "poisoning.hidden-instructions": {
    "id": "poisoning.hidden-instructions",
    "category": "poisoning",
    "subject": "server",
    "severity": "error",
    "title": "Hidden instruction block",
    "rationale": "The description carries a block addressed to the model rather than to you — a pseudo-tag or an HTML comment. Anything you do not see in the tool list but the model does is a channel for instructions you never approved."
  },
  "poisoning.invisible-unicode": {
    "id": "poisoning.invisible-unicode",
    "category": "poisoning",
    "subject": "server",
    "severity": "error",
    "title": "Invisible characters in definition",
    "rationale": "Zero-width, bidi-control or private-use characters sit in the tool's name or description, where they are invisible to you and meaningful to the model. A tool definition has no legitimate reason to carry them."
  },
  "poisoning.oversized-description": {
    "id": "poisoning.oversized-description",
    "category": "poisoning",
    "subject": "server",
    "severity": "warning",
    "title": "Oversized tool description",
    "rationale": "The description is long enough to hide a second instruction set or an embedded protocol in plain sight, and it costs that context on every single call. Read it end to end, then ask the vendor to trim it."
  },
  "annotation.destructive-unmarked": {
    "id": "annotation.destructive-unmarked",
    "category": "annotation",
    "subject": "server",
    "severity": "warning",
    "title": "Destructive tool not marked",
    "rationale": "The tool reads as deleting or overwriting something but carries no destructiveHint, so a host that confirms destructive calls will not confirm this one. Set the hint, or rename the tool if it is not actually destructive."
  },
  "annotation.readonly-contradiction": {
    "id": "annotation.readonly-contradiction",
    "category": "annotation",
    "subject": "server",
    "severity": "error",
    "title": "readOnlyHint contradicts the tool",
    "rationale": "The tool claims readOnlyHint: true while its name or description describes a mutation. A host that skips approval for read-only tools will run this one unattended, which makes the wrong hint worse than no hint at all."
  },
  "annotation.open-world-unmarked": {
    "id": "annotation.open-world-unmarked",
    "category": "annotation",
    "subject": "server",
    "severity": "info",
    "title": "Open-world tool not marked",
    "rationale": "The tool appears to reach the network or an external system without declaring openWorldHint, so a host cannot tell you its result came from outside your control. Adding the hint costs nothing and changes no behaviour."
  },
  "schema.secret-shaped-parameter": {
    "id": "schema.secret-shaped-parameter",
    "category": "schema",
    "subject": "server",
    "severity": "warning",
    "title": "Credential-shaped parameter",
    "rationale": "A free-text parameter is named like a credential, which invites the model to put a real secret into a tool argument that then gets logged, metered and replayed. Have the server read that credential from its own configuration instead."
  },
  "schema.undescribed-parameter": {
    "id": "schema.undescribed-parameter",
    "category": "schema",
    "subject": "server",
    "severity": "info",
    "title": "Parameter has no description",
    "rationale": "The parameter carries no description, so the model has to guess what belongs in it from the name alone. That is a correctness problem before it is a cost problem: guessed arguments mean failed calls and retries."
  },
  "schema.unconstrained-additional-properties": {
    "id": "schema.unconstrained-additional-properties",
    "category": "schema",
    "subject": "server",
    "severity": "info",
    "title": "Unconstrained object schema",
    "rationale": "The object schema neither forbids additional properties nor constrains them, so the model may invent fields the server silently accepts or silently drops. Setting additionalProperties: false makes the contract checkable."
  },
  "oauth.broad-scope": {
    "id": "oauth.broad-scope",
    "category": "oauth",
    "subject": "server",
    "severity": "warning",
    "title": "Broad OAuth scope",
    "rationale": "The stored OAuth grant asks for a wildcard or whole-account scope on a server used for one job. If that server is compromised the blast radius is everything the scope reaches — request the narrowest scope that still works."
  },
  "skill-surface.injection-phrasing": {
    "id": "skill-surface.injection-phrasing",
    "category": "skill-surface",
    "subject": "skill",
    "severity": "error",
    "title": "Injection phrasing in SKILL.md",
    "rationale": "The skill body tells the model to override its own instructions or to keep something from you. SKILL.md is loaded verbatim into context every time this skill is attached, so this steers every run that uses it — treat it as hostile until the author explains it."
  },
  "skill-surface.hidden-instructions": {
    "id": "skill-surface.hidden-instructions",
    "category": "skill-surface",
    "subject": "skill",
    "severity": "error",
    "title": "Hidden instruction block in SKILL.md",
    "rationale": "The skill body carries a block addressed to the model rather than to you — a pseudo-tag, or a comment that renders as nothing while the model still reads it. Anything you do not see in the rendered skill but the model does is a channel for instructions you never approved."
  },
  "skill-surface.invisible-unicode": {
    "id": "skill-surface.invisible-unicode",
    "category": "skill-surface",
    "subject": "skill",
    "severity": "error",
    "title": "Invisible characters in the skill",
    "rationale": "Zero-width, bidi-control or private-use characters sit in the skill body, its frontmatter or a file path, where they are invisible to you and meaningful to the model. Skill text that a human wrote has no legitimate reason to carry them."
  },
  "skill-surface.credential-in-body": {
    "id": "skill-surface.credential-in-body",
    "category": "skill-surface",
    "subject": "skill",
    "severity": "warning",
    "title": "Credential-shaped value in SKILL.md",
    "rationale": "The skill body contains a run of text shaped like a real API key or token. Skill content is stored, versioned, exported and read into model context, so a secret pasted into it has already travelled further than you meant — rotate it and read the value from configuration instead."
  },
  "skill-surface.broad-allowed-tools": {
    "id": "skill-surface.broad-allowed-tools",
    "category": "skill-surface",
    "subject": "skill",
    "severity": "warning",
    "title": "Broad allowed-tools grant",
    "rationale": "The frontmatter grants this skill a wildcard or an unrestricted command executor, so attaching it hands the model every tool rather than the few the skill needs. Narrow the grant to the specific tools and command prefixes the instructions actually use."
  },
  "skill-surface.executable-scripts": {
    "id": "skill-surface.executable-scripts",
    "category": "skill-surface",
    "subject": "skill",
    "severity": "info",
    "title": "Skill ships executable scripts",
    "rationale": "The version contains script files. This app never runs them — it stores and meters skill content — but an agent host that does will execute whatever they contain, so read them before you attach this skill anywhere that can."
  },
  "skill-surface.network-reference": {
    "id": "skill-surface.network-reference",
    "category": "skill-surface",
    "subject": "skill",
    "severity": "info",
    "title": "SKILL.md references the network",
    "rationale": "The skill body contains an absolute http(s) URL, which is a hint that following the instructions reaches outside your control. This is a lexical scan of the prose and not a taint analysis, so treat it as a place to look rather than as proof of a network call."
  }
} as const;

/** The signature tables, exactly as the pack declares them. Compiled by `security-tables.ts`. */
export const BUNDLED_SECURITY_SIGNATURES = {
  "evidenceContextChars": 40,
  "maxDescriptionChars": 2000,
  "schemaWalkMaxDepth": 12,
  "schemaWalkMaxNodes": 2000,
  "injection": {
    "phrases": [
      {
        "phrase": "ignore previous",
        "requiresInstructionObject": true
      },
      {
        "phrase": "ignore all previous",
        "requiresInstructionObject": true
      },
      {
        "phrase": "disregard previous",
        "requiresInstructionObject": true
      },
      {
        "phrase": "disregard the above",
        "requiresInstructionObject": true
      },
      {
        "phrase": "do not tell the user"
      },
      {
        "phrase": "don't tell the user"
      },
      {
        "phrase": "without telling the user"
      },
      {
        "phrase": "do not mention this"
      },
      {
        "phrase": "before using any other tool"
      },
      {
        "phrase": "before doing anything else"
      },
      {
        "phrase": "you must first read"
      },
      {
        "phrase": "override your instructions"
      },
      {
        "phrase": "override the system"
      }
    ],
    "instructionObjects": [
      "instruction",
      "instructions",
      "prompt",
      "prompts",
      "message",
      "messages",
      "direction",
      "directions",
      "rule",
      "rules",
      "guidance",
      "context",
      "command",
      "commands",
      "order",
      "orders",
      "turn",
      "turns"
    ],
    "objectModifiers": [
      "the",
      "all",
      "any",
      "your",
      "my",
      "own",
      "above",
      "earlier",
      "prior",
      "user",
      "system",
      "assistant",
      "other"
    ],
    "note": "The whole of the injection heuristic: exact strings, not semantics. It deliberately does NOT match a bare 'ignore'/'override'/'system' anywhere in a description (that would fire on half the honest servers in the world), does NOT match the four phrases whose object is a plain noun in ordinary prose unless an instruction-object noun follows them (that is what requiresInstructionObject is for), and does NOT match paraphrases. A determined attacker rewrites around it; it exists to catch the copy-pasted payloads that make up nearly all of what is seen in the wild, without a false-positive rate that gets the whole report ignored. `instructionObjects` are the nouns that turn a phrase into an instruction override; `objectModifiers` are the filler allowed between the two."
  },
  "hiddenInstructions": {
    "htmlComment": {
      "source": "<!--[\\s\\S]*?-->",
      "flags": ""
    },
    "pseudoTag": {
      "source": "<\\/?(IMPORTANT|SYSTEM|INSTRUCTION|INSTRUCTIONS|SECRET|ADMIN)\\b[^>]*>",
      "flags": ""
    },
    "modelAddress": {
      "source": "note to (?:the )?(?:assistant|model|ai)\\b|ai instructions?:",
      "flags": "i"
    },
    "note": "Three shapes of text addressed to the model rather than to the reader. `htmlComment` does NOT match a lone opener or closer — an unterminated comment is a typo, not a payload. `pseudoTag` is case-SENSITIVE on purpose (note the absent i flag): the shouted form is the prompt-injection idiom and the lower-case forms are ordinary words inside real markup, so it does not match <b>, <code>, or any tag outside its six names. `modelAddress` matches the ADDRESS form only; a description that merely contains the word assistant does not fire."
  },
  "invisibleCodePointRanges": [
    [
      8203,
      8207
    ],
    [
      8234,
      8238
    ],
    [
      8288,
      8292
    ],
    [
      65279,
      65279
    ],
    [
      57344,
      63743
    ],
    [
      917504,
      917631
    ]
  ],
  "destructiveVerbs": [
    "delete",
    "deletes",
    "deleted",
    "deleting",
    "deletion",
    "deletions",
    "remove",
    "removes",
    "removed",
    "removing",
    "removal",
    "drop",
    "drops",
    "dropped",
    "dropping",
    "destroy",
    "destroys",
    "destroyed",
    "destroying",
    "purge",
    "purges",
    "purged",
    "purging",
    "truncate",
    "truncates",
    "truncated",
    "truncating",
    "revoke",
    "revokes",
    "revoked",
    "revoking",
    "terminate",
    "terminates",
    "terminated",
    "terminating",
    "wipe",
    "wipes",
    "wiped",
    "wiping",
    "erase",
    "erases",
    "erased",
    "erasing"
  ],
  "mutatingVerbsInName": [
    "delete",
    "deletes",
    "remove",
    "removes",
    "write",
    "writes",
    "create",
    "creates",
    "update",
    "updates",
    "insert",
    "inserts",
    "drop",
    "drops",
    "send",
    "sends",
    "post",
    "posts",
    "patch",
    "patches",
    "set",
    "sets",
    "put",
    "puts"
  ],
  "mutatingVerbsInDescription": [
    "deletes",
    "removes",
    "writes",
    "creates",
    "inserts",
    "drops",
    "sends"
  ],
  "readVerbsInName": [
    "get",
    "list",
    "read",
    "fetch",
    "describe",
    "search",
    "query",
    "find",
    "show"
  ],
  "weakMutatingVerbsInName": [
    "set",
    "sets",
    "put",
    "puts"
  ],
  "weakVerbMaxLeadingOffset": 1,
  "openWorldNameTerms": [
    "fetch",
    "fetches",
    "fetched",
    "fetching",
    "http",
    "https",
    "url",
    "urls",
    "uri",
    "uris",
    "web",
    "search",
    "searches",
    "searching",
    "browse",
    "browses",
    "browsing",
    "download",
    "downloads",
    "downloading",
    "upload",
    "uploads",
    "uploading",
    "remote"
  ],
  "openWorldDescriptionTerms": [
    "fetches",
    "fetched",
    "fetching",
    "searches",
    "searching",
    "browses",
    "browsing",
    "downloads",
    "downloading",
    "uploads",
    "uploading"
  ],
  "openWorldPhrase": {
    "source": "external\\s+api",
    "flags": "i"
  },
  "secretParameterPattern": {
    "source": "(^|_)(token|password|passwd|secret|api[_-]?key|apikey|credential|credentials|private[_-]?key|access[_-]?key)($|_)",
    "flags": ""
  },
  "secretParameterMeasurementSuffixes": [
    "count",
    "counts",
    "limit",
    "limits",
    "length",
    "size",
    "budget",
    "usage",
    "total",
    "totals",
    "type",
    "kind",
    "name",
    "names",
    "id",
    "ids",
    "index",
    "estimate",
    "ratio",
    "threshold",
    "max",
    "min",
    "profile",
    "format",
    "prefix",
    "suffix",
    "required",
    "enabled",
    "present"
  ],
  "broadOauthScopePatterns": [
    {
      "source": "^\\*$",
      "flags": "i"
    },
    {
      "source": "^all$",
      "flags": "i"
    },
    {
      "source": "^admin$",
      "flags": "i"
    },
    {
      "source": "^full[_-]?access$",
      "flags": "i"
    },
    {
      "source": "^.*:\\*$",
      "flags": "i"
    },
    {
      "source": "^(repo|write:org|admin:.*)$",
      "flags": "i"
    }
  ],
  "broadAllowedToolPatterns": [
    {
      "source": "^\\*$",
      "flags": "i"
    },
    {
      "source": "^(bash|shell|execute)$",
      "flags": "i"
    },
    {
      "source": "^(bash|shell|execute)\\(\\s*\\*\\s*\\)$",
      "flags": "i"
    }
  ],
  "skillScriptLangLabels": {
    "py": "python",
    "js": "javascript",
    "ts": "typescript",
    "sh": "shell",
    "bash": "shell",
    "rb": "ruby",
    "go": "go"
  },
  "skillNetworkRefPattern": {
    "source": "\\bhttps?:\\/\\/[^\\s\"'<>)]+",
    "flags": "i"
  },
  "note": "Every ageing literal the two security analyzers match on (RM-38 WP 2.1; the rules that consume them are apps/api/src/security/{analyzer,skill-analyzer,text-scan}.ts). Each list's `…Note` field is its false-positive review: what the list deliberately does NOT match, and why. Read it before adding a term — a heuristic that cries wolf is a heuristic nobody reads, and the near-miss fixtures in apps/api/test/security-*.test.ts are the standing proof that the negatives hold.",
  "invisibleCodePointRangesNote": "Code points a tool definition or a skill body has no legitimate reason to carry. Deliberately NOT matched: ordinary punctuation and accented letters — an em-dash, a curly quote, an accented vowel and every emoji sit outside these ranges, so text written by a human with a decent keyboard never fires. Nor a newline or a tab, which are legitimate in a long description and are escaped into visibility by the evidence redactor anyway. What IS matched is text invisible to a reader and meaningful to a model: zero-width spaces and joiners, the bidi overrides that let a name render backwards, the invisible math operators, the BOM, the Unicode TAG block (the smuggled-ASCII carrier), and the private-use area.",
  "destructiveVerbsNote": "Written out in every inflection rather than stemmed, because spelling the forms out is what makes the false-positive review reviewable. The token boundary is a non-alphanumeric, so a verb listed here does not match inside a longer word: the drop-down control and the un-prefixed undo verbs are both safe, and no stem can quietly pull in an unrelated noun.",
  "mutatingVerbsInNameNote": "Matched in the tool NAME, which is an identifier the server chose — a token here is a claim about what the tool does, never incidental prose. Deliberately absent: the past participles. Those describe a STATE the tool reads rather than an action it performs, and firing the analyzer's one error severity on a listing tool with an honest read-only hint is exactly the false positive that teaches an operator to stop reading the loudest severity in the report. `readVerbsInName` wins when it appears earlier in the name, and `weakMutatingVerbsInName` fire only from the leading verb position (see weakVerbMaxLeadingOffset) — both guards were added after a plain getter on three of the owner's own Qlik servers scored an error out of a noun.",
  "mutatingVerbsInDescriptionNote": "Matched in the DESCRIPTION — third-person-singular forms only. The bare infinitives are all common NOUNS in tool prose, and matching those would turn the one error in the annotation family into the noisiest rule in the report. The -s form is unambiguously verbal in the way honest servers actually write a mutation. Deliberately absent even in -s form: the five whose plural is a common noun.",
  "openWorldNote": "`openWorldNameTerms` is the fuller list, because a NAME is a label the author chose for what the tool DOES, so a noun there is as strong a signal as a verb. `openWorldDescriptionTerms` is deliberately SMALLER: prose names the data a tool RETURNS as often as it names what the tool does, and two real false positives on this app's own MCP mount are why — a list tool flagged for a field name it returns, another for an enum value it returns. Neither reaches anything; both read the local database. So only unambiguous action inflections survive on the description side. Nothing was added to the vocabulary; the list was split. This is the quietest rule in the plan (info) precisely because plenty of honest servers just omit the hint.",
  "secretParameterNote": "`secretParameterPattern` is anchored on underscore-separated segment boundaries so it reads whole words rather than substrings; parameter names are normalized to snake_case first, which is what lets one anchored pattern read camelCase and snake_case identically instead of silently missing every camelCase schema. `secretParameterMeasurementSuffixes` are the trailing segments that turn a credential-shaped name into a MEASUREMENT or a REFERENCE rather than a place a secret goes — a count, a vault entry's name, the public half of a key pair. Note what survives the list: a name ending in the bare word `key` is not suffixed away, so a real secret access key still fires.",
  "broadOauthScopeNote": "Scope shapes that grant far more than one job needs. Deliberately NOT matched: any narrowed scope, which is nearly all of them. Every pattern is anchored end to end for exactly that reason, so a wildcard grant fires while its narrowed siblings do not, and a substring of a longer scope name never matches. Matched case-insensitively — a provider that returns an upper-case scope is granting the same thing.",
  "broadAllowedToolNote": "Grant tokens that hand a skill more than the few tools it needs. Deliberately NOT matched: a parenthesised restriction. A narrowed executor grant is the GOOD case — the thing we want authors to write — and firing on it would punish exactly the behaviour the rule exists to encourage. Nor does a named tool match, nor a tool whose name merely CONTAINS one of the executor words, because every pattern is anchored end to end against a single whitespace-separated token.",
  "skillNetworkRefNote": "A rough network-reference detector, light on purpose: it flags absolute http(s) URLs so an operator can spot an external call in the prose, and never claims more than that. Deliberately NOT matched: a relative Markdown link, a bare domain with no scheme, a mailto: or file: URI, or a package name that merely contains a slash. The scheme is the whole signal; anything looser would fire on ordinary prose and make the info finding it feeds worthless. It is a lexical scan, NOT a taint analysis — it says there is a URL in here to go and read, never that this skill makes a network call."
} as const;
