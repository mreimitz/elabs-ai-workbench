#!/usr/bin/env python3
"""Validate and maintain the Research Scaffold OKF knowledge tree.

The runtime is intentionally dependency-free. Frontmatter is restricted to a
small JSON-compatible YAML 1.2 subset: one ``key: value`` pair per line, with
values encoded as JSON strings, arrays, numbers, booleans, or null. This subset
is valid YAML and keeps hook execution deterministic without network installs.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable, Optional


RESERVED_NAMES = {"index.md", "log.md"}
SKIP_DIRS = {".git", ".venv", "__pycache__"}
FRONTMATTER_ORDER = [
    "type",
    "title",
    "description",
    "resource",
    "tags",
    "timestamp",
    "status",
    "name",
    "argument-hint",
]
TIMESTAMP_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")
DATE_RE = re.compile(r"^## (\d{4}-\d{2}-\d{2})$")
LINK_RE = re.compile(r"!?\[[^\]]*\]\(([^)]+)\)")
PLACEHOLDER_RE = re.compile(r"\{\{[^}]+\}\}")
DELIVERED_HEADING = "## Delivered increments"
INCREMENT_RE = re.compile(r"^###\s+(RM-\d{2,})(?:\s|$)")
MILESTONES_HEADING = "## Milestones"
# An unticked work-package box in a STATUS.md ledger: "- [ ] WP 1.4 - ...".
LEDGER_OPEN_RE = re.compile(r"^\s*[-*]\s+\[ \]")
# The documentation domain root. Named user-guide here; a DC subject holds both the
# delivery record (doc.md) and that part of the system's user-facing guide pages.
DOCU_ROOT = "user-guide"


@dataclass(frozen=True)
class Domain:
    """One knowledge domain: its tag prefix, roots on disk, and diagnostics.

    Roadmap is the only two-root domain. Its ``RM`` numbers are a single space
    shared by ``Roadmap/`` and ``Roadmap/completed/``, so allocation and
    uniqueness must always consider both roots together.
    """

    key: str
    prefix: str
    label: str
    roots: tuple[str, ...]
    default_root: str
    concept_file: str
    concept_type: str
    required_children: tuple[str, ...]
    child_dirs: tuple[str, ...]
    loose_files: frozenset[str]
    naming_message: str
    structure_message: str
    incomplete_code: str
    path_code: str
    path_message: str


DOMAINS: tuple[Domain, ...] = (
    Domain(
        key="rs",
        prefix="RS",
        label="Research",
        roots=("Research",),
        default_root="Research",
        concept_file="topic.md",
        concept_type="Research Topic",
        required_children=("topic.md", "log.md", "sources", "notes", "outputs"),
        child_dirs=("sources", "notes", "outputs"),
        loose_files=frozenset({"index.md"}),
        naming_message="research directory must be RS-NN-lowercase-slug",
        structure_message="research topic structure is incomplete",
        incomplete_code="PROFILE016",
        path_code="PROFILE026",
        path_message="Research content must live in Research/RS-NN-slug/",
    ),
    Domain(
        key="rm",
        prefix="RM",
        label="Roadmap",
        roots=("Roadmap", "Roadmap/completed"),
        default_root="Roadmap",
        concept_file="item.md",
        concept_type="Roadmap Item",
        required_children=("item.md", "log.md"),
        child_dirs=(),
        loose_files=frozenset({"index.md", "roadmap.md"}),
        naming_message="roadmap directory must be RM-NN-lowercase-slug",
        structure_message="roadmap item structure is incomplete",
        incomplete_code="PROFILE017",
        path_code="PROFILE027",
        path_message=(
            "Roadmap detail must live in Roadmap/RM-NN-slug/ "
            "or Roadmap/completed/RM-NN-slug/"
        ),
    ),
    Domain(
        key="dc",
        prefix="DC",
        label="Documentation",
        roots=(DOCU_ROOT,),
        default_root=DOCU_ROOT,
        concept_file="doc.md",
        concept_type="Documentation",
        required_children=("doc.md", "log.md"),
        child_dirs=(),
        loose_files=frozenset({"index.md"}),
        naming_message="documentation directory must be DC-NN-lowercase-slug",
        structure_message="documentation subject structure is incomplete",
        incomplete_code="PROFILE033",
        path_code="PROFILE034",
        path_message=f"Documentation must live in {DOCU_ROOT}/DC-NN-slug/",
    ),
)
DOMAIN_BY_PREFIX = {domain.prefix: domain for domain in DOMAINS}
COMPLETED_ROOT = "Roadmap/completed"
# Roots that must always exist. The newer roots are guarded on presence so the
# bundle stays valid between shipping this code and creating the directories.
REQUIRED_DOMAIN_ROOTS = frozenset({"Research", "Roadmap"})
FIXED_DIRECTORY_TITLES = {
    ".claude": "Claude Controls",
    "Research": "Research Topics",
    "Roadmap": "Roadmap",
    "Roadmap/completed": "Completed Roadmap Items",
    DOCU_ROOT: "Documentation",
}
CHILD_DIRECTORY_TITLES = {
    "sources": "Sources",
    "notes": "Research Notes",
    "outputs": "Research Outputs",
}

TAG_DIR_RE = re.compile(
    r"^("
    + "|".join(domain.prefix for domain in DOMAINS)
    + r")-(\d{2,})-[a-z0-9]+(?:-[a-z0-9]+)*$"
)


@dataclass(frozen=True)
class Issue:
    layer: str
    code: str
    path: str
    message: str

    def as_dict(self) -> dict[str, str]:
        return {
            "layer": self.layer,
            "code": self.code,
            "path": self.path,
            "message": self.message,
        }


class ProfileError(ValueError):
    """Raised when a document violates the constrained frontmatter grammar."""


def project_root_from_script() -> Path:
    return Path(__file__).resolve().parents[2]


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def advance_timestamp(previous: Optional[Any]) -> str:
    """A UTC stamp strictly newer than ``previous``.

    Concept edits must change the timestamp (PROFILE028). Two edits inside the
    same second would otherwise render an identical value.
    """
    stamp = utc_now()
    if not isinstance(previous, str) or stamp != previous:
        return stamp
    moment = datetime.strptime(previous, "%Y-%m-%dT%H:%M:%SZ") + timedelta(seconds=1)
    return moment.strftime("%Y-%m-%dT%H:%M:%SZ")


def today() -> str:
    return datetime.now(timezone.utc).date().isoformat()


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def _atomic_write(path: Path, content: str) -> None:
    """Write ``content`` byte-for-byte, without the trailing-newline normalization."""
    path.parent.mkdir(parents=True, exist_ok=True)
    handle = tempfile.NamedTemporaryFile(
        mode="w",
        encoding="utf-8",
        dir=path.parent,
        prefix=f".{path.name}.",
        suffix=".tmp",
        delete=False,
    )
    temporary_path = Path(handle.name)
    try:
        with handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temporary_path, path.stat().st_mode & 0o777 if path.exists() else 0o644)
        os.replace(temporary_path, path)
    finally:
        temporary_path.unlink(missing_ok=True)


def write_text_if_changed(path: Path, content: str) -> bool:
    normalized = content.rstrip() + "\n"
    if path.exists() and read_text(path) == normalized:
        return False
    _atomic_write(path, normalized)
    return True


def load_profile(root: Path) -> dict[str, Any]:
    profile_path = root / ".claude" / "okf-profile.json"
    try:
        return json.loads(read_text(profile_path))
    except (OSError, json.JSONDecodeError) as exc:
        raise ProfileError(f"cannot load {profile_path}: {exc}") from exc


def parse_frontmatter(text: str) -> tuple[Optional[dict[str, Any]], str]:
    """Parse the profile's JSON-compatible YAML subset."""
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        return None, text

    try:
        end = next(index for index in range(1, len(lines)) if lines[index].strip() == "---")
    except StopIteration as exc:
        raise ProfileError("frontmatter has no closing '---' delimiter") from exc

    metadata: dict[str, Any] = {}
    for line_number, raw_line in enumerate(lines[1:end], start=2):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if ":" not in line:
            raise ProfileError(f"frontmatter line {line_number} is not 'key: value'")
        key, raw_value = line.split(":", 1)
        key = key.strip()
        raw_value = raw_value.strip()
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_-]*", key):
            raise ProfileError(f"frontmatter line {line_number} has invalid key {key!r}")
        if key in metadata:
            raise ProfileError(f"frontmatter key {key!r} is duplicated")
        if not raw_value:
            raise ProfileError(f"frontmatter key {key!r} has no value")
        try:
            metadata[key] = json.loads(raw_value)
        except json.JSONDecodeError as exc:
            raise ProfileError(
                f"frontmatter value for {key!r} must use JSON-compatible YAML"
            ) from exc

    body = "\n".join(lines[end + 1 :]).lstrip("\n")
    return metadata, body


def render_frontmatter(metadata: dict[str, Any], body: str) -> str:
    keys = [key for key in FRONTMATTER_ORDER if key in metadata]
    keys.extend(sorted(key for key in metadata if key not in keys))
    lines = ["---"]
    for key in keys:
        lines.append(f"{key}: {json.dumps(metadata[key], ensure_ascii=False)}")
    lines.extend(["---", "", body.rstrip(), ""])
    return "\n".join(lines)


def markdown_files(root: Path) -> Iterable[Path]:
    for current, dirs, files in os.walk(root):
        dirs[:] = sorted(directory for directory in dirs if directory not in SKIP_DIRS)
        for filename in sorted(files):
            if filename.endswith(".md"):
                yield Path(current) / filename


def relative(root: Path, path: Path) -> str:
    return path.relative_to(root).as_posix()


def domain_item_dirs(root: Path, domain: Domain) -> list[Path]:
    """Every ``<PREFIX>-*`` directory across all of a domain's roots.

    ``startswith`` rather than a full match, so a malformed name still reaches
    the naming check instead of disappearing from validation.
    """
    found: list[Path] = []
    for rel in domain.roots:
        base = root / rel
        if not base.is_dir():
            continue
        for child in sorted(base.iterdir(), key=lambda value: value.name):
            if child.is_dir() and child.name.startswith(domain.prefix + "-"):
                found.append(child)
    return found


def item_tag(name: str) -> Optional[str]:
    """Zero-padded tag for an item directory name, or None if it is malformed."""
    match = TAG_DIR_RE.fullmatch(name)
    return f"{match.group(1)}-{int(match.group(2)):02d}" if match else None


def normalize_tag(value: str, prefix: str) -> str:
    digits = value.strip().upper().removeprefix(prefix + "-")
    if not digits.isdigit():
        raise ValueError(f"{value!r} is not a {prefix} tag")
    return f"{prefix}-{int(digits):02d}"


def first_nonblank_line(body: str) -> str:
    return next((line.strip() for line in body.splitlines() if line.strip()), "")


def validate_index(root: Path, path: Path, text: str) -> list[Issue]:
    rel = relative(root, path)
    issues: list[Issue] = []
    try:
        metadata, body = parse_frontmatter(text)
    except ProfileError as exc:
        return [Issue("okf", "OKF003", rel, str(exc))]

    if rel == "index.md":
        if metadata is None:
            issues.append(
                Issue("profile", "PROFILE020", rel, "root index must declare okf_version")
            )
        elif metadata != {"okf_version": "0.1"}:
            issues.append(
                Issue(
                    "profile",
                    "PROFILE021",
                    rel,
                    'root index frontmatter must contain only okf_version: "0.1"',
                )
            )
    elif metadata is not None:
        issues.append(
            Issue("okf", "OKF004", rel, "non-root index.md must not contain frontmatter")
        )

    if not first_nonblank_line(body).startswith("# "):
        issues.append(
            Issue("okf", "OKF005", rel, "index body must begin with a level-one heading")
        )
    return issues


def validate_log(root: Path, path: Path, text: str) -> list[Issue]:
    rel = relative(root, path)
    issues: list[Issue] = []
    try:
        metadata, body = parse_frontmatter(text)
    except ProfileError as exc:
        return [Issue("okf", "OKF006", rel, str(exc))]
    if metadata is not None:
        issues.append(Issue("okf", "OKF007", rel, "log.md must not contain frontmatter"))
    if not first_nonblank_line(body).startswith("# "):
        issues.append(
            Issue("okf", "OKF008", rel, "log body must begin with a level-one heading")
        )
    date_headings = [
        match.group(1)
        for line in body.splitlines()
        if (match := DATE_RE.fullmatch(line.strip()))
    ]
    if not date_headings:
        issues.append(
            Issue("okf", "OKF009", rel, "log must contain an ISO 8601 date heading")
        )
    for value in date_headings:
        try:
            datetime.strptime(value, "%Y-%m-%d")
        except ValueError:
            issues.append(Issue("okf", "OKF010", rel, f"invalid log date {value!r}"))
    if date_headings != sorted(date_headings, reverse=True):
        issues.append(
            Issue("profile", "PROFILE022", rel, "log date headings must be newest first")
        )
    return issues


def validate_concept(
    root: Path, path: Path, text: str, profile: dict[str, Any]
) -> tuple[list[Issue], Optional[dict[str, Any]], str]:
    rel = relative(root, path)
    issues: list[Issue] = []
    try:
        metadata, body = parse_frontmatter(text)
    except ProfileError as exc:
        return [Issue("okf", "OKF001", rel, str(exc))], None, ""

    if metadata is None:
        return [
            Issue("okf", "OKF001", rel, "concept must begin with YAML frontmatter")
        ], None, body

    concept_type = metadata.get("type")
    if not isinstance(concept_type, str) or not concept_type.strip():
        issues.append(Issue("okf", "OKF002", rel, "type must be a non-empty string"))

    for field in profile["required_fields"]:
        value = metadata.get(field)
        if value is None or value == "" or value == []:
            issues.append(
                Issue("profile", "PROFILE001", rel, f"required field {field!r} is missing")
            )

    title = metadata.get("title")
    description = metadata.get("description")
    tags = metadata.get("tags")
    timestamp = metadata.get("timestamp")
    status = metadata.get("status")

    if title is not None and not isinstance(title, str):
        issues.append(Issue("profile", "PROFILE002", rel, "title must be a string"))
    if description is not None and (
        not isinstance(description, str) or "\n" in description
    ):
        issues.append(
            Issue("profile", "PROFILE003", rel, "description must be a one-line string")
        )
    if tags is not None and (
        not isinstance(tags, list)
        or not tags
        or any(not isinstance(tag, str) or not tag.strip() for tag in tags)
    ):
        issues.append(
            Issue("profile", "PROFILE004", rel, "tags must be a non-empty string list")
        )
    if timestamp is not None:
        if not isinstance(timestamp, str) or not TIMESTAMP_RE.fullmatch(timestamp):
            issues.append(
                Issue(
                    "profile",
                    "PROFILE005",
                    rel,
                    "timestamp must use UTC YYYY-MM-DDTHH:MM:SSZ form",
                )
            )
        else:
            try:
                datetime.strptime(timestamp, "%Y-%m-%dT%H:%M:%SZ")
            except ValueError:
                issues.append(
                    Issue("profile", "PROFILE005", rel, "timestamp is not a valid datetime")
                )

    allowed_statuses = profile["types"].get(concept_type)
    if concept_type and allowed_statuses is None:
        issues.append(
            Issue(
                "profile",
                "PROFILE006",
                rel,
                f"type {concept_type!r} is not registered",
            )
        )
    elif allowed_statuses is not None and status not in allowed_statuses:
        issues.append(
            Issue(
                "profile",
                "PROFILE007",
                rel,
                f"status {status!r} is invalid for type {concept_type!r}",
            )
        )

    if not body.strip():
        issues.append(Issue("profile", "PROFILE008", rel, "concept body must not be empty"))
    placeholder_text = text
    if concept_type == "Source Reference":
        placeholder_text = body.split("## Extracted content", 1)[0]
    if PLACEHOLDER_RE.search(placeholder_text):
        issues.append(
            Issue("profile", "PROFILE009", rel, "live concept contains a template placeholder")
        )
    if (
        concept_type in profile["citation_required_types"]
        and not re.search(r"(?m)^# Citations\s*$", body)
    ):
        issues.append(
            Issue(
                "profile",
                "PROFILE010",
                rel,
                f"{concept_type} must contain a '# Citations' section",
            )
        )

    if concept_type == "Roadmap Item":
        parts = Path(rel).parts
        if parts and parts[0] == "Roadmap":
            in_completed = len(parts) >= 3 and parts[1] == "completed"
            if status == "done" and not in_completed:
                issues.append(
                    Issue(
                        "profile",
                        "PROFILE032",
                        rel,
                        "a done roadmap item must live under Roadmap/completed/; "
                        "use 'okf.py complete-roadmap'",
                    )
                )
            if in_completed and status != "done":
                issues.append(
                    Issue(
                        "profile",
                        "PROFILE035",
                        rel,
                        "a roadmap item under Roadmap/completed/ must have status 'done'",
                    )
                )

    if concept_type == "Documentation":
        increments = delivered_increments(body)
        if increments is None:
            issues.append(
                Issue(
                    "profile",
                    "PROFILE039",
                    rel,
                    f"Documentation must contain a '{DELIVERED_HEADING}' section",
                )
            )
        elif not increments and status in {"review", "current"}:
            # 'draft' is exempt so a freshly generated subject validates before
            # anything has shipped into it.
            issues.append(
                Issue(
                    "profile",
                    "PROFILE037",
                    rel,
                    "Documentation beyond draft must record at least one "
                    "'### RM-NN' delivered increment",
                )
            )

    return issues, metadata, body


def resolve_link(root: Path, source: Path, target: str) -> Optional[Path]:
    target = target.strip().split(maxsplit=1)[0]
    target = target.split("#", 1)[0].split("?", 1)[0]
    if not target or target.startswith("#"):
        return None
    if re.match(r"^[A-Za-z][A-Za-z0-9+.-]*:", target) or target.startswith("//"):
        return None
    if target.startswith("/"):
        return root / target.lstrip("/")
    return source.parent / target


def validate_links(root: Path, path: Path, text: str) -> list[Issue]:
    rel = relative(root, path)
    issues: list[Issue] = []
    link_text = text
    if path.name not in RESERVED_NAMES:
        try:
            metadata, body = parse_frontmatter(text)
        except ProfileError:
            metadata, body = None, text
        if metadata and metadata.get("type") == "Source Reference":
            # Converted source bodies may faithfully contain unresolved links from the
            # original document. Validate provenance links, not opaque extracted content.
            link_text = body.split("## Extracted content", 1)[0]
    for raw_target in LINK_RE.findall(link_text):
        resolved = resolve_link(root, path, raw_target)
        if resolved is None:
            continue
        resolved = Path(os.path.normpath(resolved))
        try:
            resolved.relative_to(root)
        except ValueError:
            issues.append(
                Issue(
                    "profile",
                    "PROFILE011",
                    rel,
                    f"internal link escapes the bundle: {raw_target}",
                )
            )
            continue
        if not resolved.exists():
            issues.append(
                Issue(
                    "profile",
                    "PROFILE012",
                    rel,
                    f"internal link target does not exist: {raw_target}",
                )
            )
    return issues


def managed_directories(root: Path) -> list[Path]:
    directories = [root]
    for domain in DOMAINS:
        for rel in domain.roots:
            base = root / rel
            if rel in REQUIRED_DOMAIN_ROOTS or base.is_dir():
                directories.append(base)
        for item in domain_item_dirs(root, domain):
            directories.append(item)
            for name in domain.child_dirs:
                content_root = item / name
                directories.append(content_root)
                if content_root.is_dir():
                    directories.extend(
                        child
                        for child in content_root.rglob("*")
                        if child.is_dir() and child.name not in SKIP_DIRS
                    )
    return directories


def validate_managed_structure(root: Path) -> list[Issue]:
    issues: list[Issue] = []
    domain_of: dict[Path, Domain] = {}
    for domain in DOMAINS:
        for item in domain_item_dirs(root, domain):
            domain_of[item] = domain
    for directory in managed_directories(root):
        rel_dir = "." if directory == root else relative(root, directory)
        if not directory.is_dir():
            issues.append(
                Issue("profile", "PROFILE013", rel_dir, "required directory is missing")
            )
            continue
        index_path = directory / "index.md"
        if not index_path.is_file():
            issues.append(
                Issue(
                    "profile",
                    "PROFILE014",
                    relative(root, index_path),
                    "managed directory must contain index.md",
                )
            )
        domain = domain_of.get(directory)
        if domain is None:
            continue
        if not TAG_DIR_RE.fullmatch(directory.name):
            issues.append(
                Issue(
                    "profile",
                    "PROFILE015",
                    relative(root, directory),
                    domain.naming_message,
                )
            )
        for required in domain.required_children:
            if not (directory / required).exists():
                issues.append(
                    Issue(
                        "profile",
                        domain.incomplete_code,
                        relative(root, directory / required),
                        domain.structure_message,
                    )
                )
    return issues


def validate_index_completeness(root: Path) -> list[Issue]:
    issues: list[Issue] = []
    for directory in managed_directories(root):
        index_path = directory / "index.md"
        if not index_path.is_file():
            continue
        text = read_text(index_path)
        expected: list[str] = []
        for child in sorted(directory.iterdir(), key=lambda value: value.name.lower()):
            if child.name in SKIP_DIRS or child.name.startswith(".okf-staging-"):
                continue
            if child.is_file() and child.suffix == ".md" and child.name not in RESERVED_NAMES:
                expected.append(child.name)
            elif child.is_dir() and (child / "index.md").is_file():
                expected.append(child.name + "/")
        linked = {target.split("#", 1)[0] for target in LINK_RE.findall(text)}
        for target in expected:
            if target not in linked:
                issues.append(
                    Issue(
                        "profile",
                        "PROFILE018",
                        relative(root, index_path),
                        f"index does not list {target}",
                    )
                )
    return issues


def validate_source_attachments(root: Path) -> list[Issue]:
    issues: list[Issue] = []
    for sources in root.glob("Research/RS-*/sources"):
        if not sources.is_dir():
            continue
        for attachment in sources.rglob("*"):
            if (
                not attachment.is_file()
                or attachment.name.startswith(".")
                or attachment.suffix == ".md"
            ):
                continue
            companion = attachment.with_suffix(".md")
            if not companion.is_file():
                issues.append(
                    Issue(
                        "profile",
                        "PROFILE019",
                        relative(root, attachment),
                        f"source attachment requires companion {companion.name}",
                    )
                )
                continue
            try:
                metadata, body = parse_frontmatter(read_text(companion))
            except ProfileError:
                continue
            if not metadata or metadata.get("type") != "Source Reference":
                issues.append(
                    Issue(
                        "profile",
                        "PROFILE029",
                        relative(root, companion),
                        "attachment companion must have type 'Source Reference'",
                    )
                )
            companion_targets = {
                target.split("#", 1)[0] for target in LINK_RE.findall(body)
            }
            if attachment.name not in companion_targets:
                issues.append(
                    Issue(
                        "profile",
                        "PROFILE030",
                        relative(root, companion),
                        f"source companion must link to {attachment.name}",
                    )
                )
    return issues


def validate_tag_uniqueness(root: Path) -> list[Issue]:
    issues: list[Issue] = []
    for domain in DOMAINS:
        # One 'seen' map per domain, not per root: RM numbers are a single space
        # shared by Roadmap/ and Roadmap/completed/.
        seen: dict[int, str] = {}
        for directory in domain_item_dirs(root, domain):
            match = TAG_DIR_RE.fullmatch(directory.name)
            if not match or match.group(1) != domain.prefix:
                continue
            number = int(match.group(2))
            if number in seen:
                issues.append(
                    Issue(
                        "profile",
                        "PROFILE023",
                        relative(root, directory),
                        f"tag {domain.prefix}-{number:02d} is already used by {seen[number]}",
                    )
                )
            seen[number] = relative(root, directory)
    return issues


def delivered_increments(body: str) -> Optional[dict[str, tuple[int, int]]]:
    """Map each ``### RM-NN`` increment to its line span.

    Returns None when the ``## Delivered increments`` section is absent, and an
    empty mapping when it is present but records nothing yet.
    """
    lines = body.splitlines()
    start = next(
        (index for index, line in enumerate(lines) if line.strip() == DELIVERED_HEADING),
        None,
    )
    if start is None:
        return None
    end = next(
        (index for index in range(start + 1, len(lines)) if lines[index].startswith("## ")),
        len(lines),
    )
    heads = [
        (index, match.group(1))
        for index in range(start + 1, end)
        if (match := INCREMENT_RE.match(lines[index]))
    ]
    spans: dict[str, tuple[int, int]] = {}
    for position, (index, tag) in enumerate(heads):
        stop = heads[position + 1][0] if position + 1 < len(heads) else end
        spans[normalize_tag(tag, "RM")] = (index, stop)
    return spans


def increment_link_tags(root: Path, source: Path, body: str) -> dict[str, set[str]]:
    """For each increment, the completed roadmap tags its own subsection links to."""
    spans = delivered_increments(body) or {}
    lines = body.splitlines()
    resolved: dict[str, set[str]] = {}
    for tag, (start, end) in spans.items():
        found: set[str] = set()
        for raw_target in LINK_RE.findall("\n".join(lines[start:end])):
            target = resolve_link(root, source, raw_target)
            if target is None:
                continue
            target = Path(os.path.normpath(target))
            try:
                parts = Path(relative(root, target)).parts
            except ValueError:
                continue
            if len(parts) >= 3 and parts[0] == "Roadmap" and parts[1] == "completed":
                linked = item_tag(parts[2])
                if linked and linked.startswith("RM-"):
                    found.add(linked)
        resolved[tag] = found
    return resolved


def validate_delivery_documentation(root: Path) -> list[Issue]:
    """Completed roadmap work and its documentation must reference each other."""
    issues: list[Issue] = []
    roadmap = DOMAIN_BY_PREFIX["RM"]
    completed = {
        tag: item
        for item in domain_item_dirs(root, roadmap)
        if item.parent.name == "completed" and (tag := item_tag(item.name))
    }
    documented: set[str] = set()
    for doc_path in sorted((root / DOCU_ROOT).glob("DC-*/doc.md")):
        try:
            metadata, body = parse_frontmatter(read_text(doc_path))
        except (OSError, ProfileError):
            continue
        if not metadata or metadata.get("type") != "Documentation":
            continue
        rel = relative(root, doc_path)
        for tag, links in increment_link_tags(root, doc_path, body).items():
            if tag in links:
                documented.add(tag)
            else:
                issues.append(
                    Issue(
                        "profile",
                        "PROFILE038",
                        rel,
                        f"delivered increment {tag} must link its completed roadmap item",
                    )
                )
    for tag in sorted(completed):
        if tag not in documented:
            issues.append(
                Issue(
                    "profile",
                    "PROFILE036",
                    relative(root, completed[tag]),
                    "completed roadmap item must be recorded as a delivered "
                    f"increment in a {DOCU_ROOT}/DC-*/doc.md",
                )
            )
    return issues


def validate(root: Path) -> list[Issue]:
    root = root.resolve()
    try:
        profile = load_profile(root)
    except ProfileError as exc:
        return [Issue("profile", "PROFILE000", ".claude/okf-profile.json", str(exc))]

    issues: list[Issue] = []
    for required in profile["required_static_paths"]:
        if not (root / required).is_file():
            issues.append(
                Issue("profile", "PROFILE024", required, "required scaffold file is missing")
            )

    for path in markdown_files(root):
        rel = relative(root, path)
        try:
            text = read_text(path)
        except (OSError, UnicodeDecodeError) as exc:
            issues.append(Issue("okf", "OKF011", rel, f"file is not readable UTF-8: {exc}"))
            continue

        if path.name == "index.md":
            issues.extend(validate_index(root, path, text))
        elif path.name == "log.md":
            issues.extend(validate_log(root, path, text))
        else:
            concept_issues, _, _ = validate_concept(root, path, text, profile)
            issues.extend(concept_issues)
        issues.extend(validate_links(root, path, text))

        issues.extend(path_policy_issues(root, path))

    issues.extend(validate_managed_structure(root))
    issues.extend(validate_index_completeness(root))
    issues.extend(validate_source_attachments(root))
    issues.extend(validate_tag_uniqueness(root))
    issues.extend(validate_delivery_documentation(root))
    return sorted(issues, key=lambda issue: (issue.path, issue.layer, issue.code, issue.message))


def concept_metadata(path: Path) -> dict[str, Any]:
    metadata, _ = parse_frontmatter(read_text(path))
    return metadata or {}


def directory_title(root: Path, directory: Path) -> str:
    """Resolve by bundle-relative path first, so nested roots keep distinct names."""
    try:
        rel = relative(root, directory)
    except ValueError:
        rel = ""
    if rel in FIXED_DIRECTORY_TITLES:
        return FIXED_DIRECTORY_TITLES[rel]
    if directory.name in CHILD_DIRECTORY_TITLES:
        return CHILD_DIRECTORY_TITLES[directory.name]
    for domain in DOMAINS:
        concept = directory / domain.concept_file
        if concept.is_file():
            return str(concept_metadata(concept).get("title", directory.name))
    return directory.name.replace("-", " ").title()


def render_index(root: Path, directory: Path) -> str:
    concepts: list[tuple[str, str, str]] = []
    sections: list[tuple[str, str, str]] = []
    for child in sorted(directory.iterdir(), key=lambda value: value.name.lower()):
        if child.name in SKIP_DIRS or child.name.startswith(".okf-staging-"):
            continue
        if child.is_file() and child.suffix == ".md" and child.name not in RESERVED_NAMES:
            metadata = concept_metadata(child)
            concepts.append(
                (
                    str(metadata.get("title", child.stem)),
                    child.name,
                    str(metadata.get("description", "Knowledge concept.")),
                )
            )
        elif child.is_dir() and (child / "index.md").is_file():
            sections.append(
                (
                    directory_title(root, child),
                    child.name + "/",
                    f"Browse {directory_title(root, child).lower()}.",
                )
            )

    lines: list[str] = []
    if directory == root:
        lines.extend(["---", 'okf_version: "0.1"', "---", ""])
    lines.append(
        f"# {directory_title(root, directory) if directory != root else 'Project Knowledge'}"
    )
    if concepts:
        lines.extend(["", "## Concepts", ""])
        lines.extend(f"* [{title}]({target}) - {description}" for title, target, description in concepts)
    if sections:
        lines.extend(["", "## Sections", ""])
        lines.extend(f"* [{title}]({target}) - {description}" for title, target, description in sections)
    if not concepts and not sections:
        lines.extend(["", "No concepts have been added yet."])
    return "\n".join(lines) + "\n"


def sync_indexes(root: Path) -> int:
    changed = 0
    directories = [directory for directory in managed_directories(root) if directory.is_dir()]
    # Deepest first: a parent index can only list a child that already has one.
    for directory in sorted(directories, key=lambda value: len(value.parts), reverse=True):
        changed += int(
            write_text_if_changed(directory / "index.md", render_index(root, directory))
        )
    return changed


def sync_master_roadmap(root: Path) -> bool:
    path = root / "Roadmap" / "roadmap.md"
    if not path.is_file():
        return False
    metadata, _ = parse_frontmatter(read_text(path))
    if metadata is None:
        raise ProfileError("Roadmap/roadmap.md has no frontmatter")

    def row(concept_path: Path) -> str:
        concept = concept_metadata(concept_path)
        target = os.path.relpath(concept_path, path.parent).replace(os.sep, "/")
        return (
            f"* [{concept_path.parent.name}]({target}) — "
            f"{concept.get('title')} · `{concept.get('status')}`"
        )

    active_rows: list[str] = []
    completed_rows: list[str] = []
    for item in domain_item_dirs(root, DOMAIN_BY_PREFIX["RM"]):
        concept_path = item / "item.md"
        if not concept_path.is_file():
            continue
        target = completed_rows if item.parent.name == "completed" else active_rows
        target.append(row(concept_path))
    rs_rows = [
        row(topic) for topic in sorted((root / "Research").glob("RS-*/topic.md"))
    ]
    dc_rows = [row(doc) for doc in sorted((root / DOCU_ROOT).glob("DC-*/doc.md"))]

    body = "\n".join(
        [
            "# Master Roadmap",
            "",
            "This concept is the live project-level index of roadmap items and research topics.",
            "",
            "## Roadmap Items",
            "",
            *(active_rows or ["No roadmap items have been created yet."]),
            "",
            "## Completed Roadmap Items",
            "",
            *(completed_rows or ["No roadmap items have been completed yet."]),
            "",
            "## Research Topics",
            "",
            *(rs_rows or ["No research topics have been created yet."]),
            "",
            "## Documentation",
            "",
            *(dc_rows or ["No documentation subjects have been created yet."]),
            "",
            "## Now / Next / Later",
            "",
            "**Now:** Define active work in the relevant roadmap item.",
            "",
            "**Next:** Prioritize planned roadmap items.",
            "",
            "**Later:** Keep parked work in explicit roadmap items rather than loose notes.",
        ]
    )
    old_body = parse_frontmatter(read_text(path))[1]
    if old_body.rstrip() == body.rstrip():
        return False
    metadata["timestamp"] = utc_now()
    return write_text_if_changed(path, render_frontmatter(metadata, body))


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    words = [word for word in slug.split("-") if word][:4]
    if not words:
        raise ValueError("title must contain at least one letter or number")
    return "-".join(words)


def registry_defaults() -> dict[str, Any]:
    defaults: dict[str, Any] = {}
    for domain in DOMAINS:
        defaults[f"next_{domain.key}"] = 1
        defaults[f"allocated_{domain.key}"] = []
    return defaults


def load_registry(root: Path) -> dict[str, Any]:
    """Load the tag registry, filling in any domain the stored file predates."""
    registry = registry_defaults()
    path = root / ".claude" / "tag-registry.json"
    if path.exists():
        registry.update(json.loads(read_text(path)))
    return registry


def save_registry(root: Path, registry: dict[str, Any]) -> None:
    path = root / ".claude" / "tag-registry.json"
    write_text_if_changed(path, json.dumps(registry, indent=2, sort_keys=True))


class AllocationLock:
    def __init__(self, root: Path):
        self.path = root / ".claude" / ".tag-allocation.lock"
        self.fd: Optional[int] = None

    def __enter__(self) -> "AllocationLock":
        try:
            self.fd = os.open(self.path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        except FileExistsError as exc:
            raise RuntimeError(
                f"tag allocation is already running; remove stale lock only after verifying: {self.path}"
            ) from exc
        os.write(self.fd, str(os.getpid()).encode("ascii"))
        return self

    def __exit__(self, exc_type: Any, exc: Any, traceback: Any) -> None:
        if self.fd is not None:
            os.close(self.fd)
        self.path.unlink(missing_ok=True)


def allocate_tag(root: Path, prefix: str) -> tuple[str, dict[str, Any]]:
    registry = load_registry(root)
    domain = DOMAIN_BY_PREFIX[prefix]
    key = domain.key
    number = int(registry[f"next_{key}"])
    # Scans every root of the domain, so a completed roadmap item still reserves
    # its number and can never be reissued to new work.
    used = {
        int(match.group(2))
        for directory in domain_item_dirs(root, domain)
        if (match := TAG_DIR_RE.fullmatch(directory.name))
    }
    allocated = {int(value.split("-")[1]) for value in registry[f"allocated_{key}"]}
    while number in used or number in allocated:
        number += 1
    tag = f"{prefix}-{number:02d}"
    registry[f"next_{key}"] = number + 1
    registry[f"allocated_{key}"].append(tag)
    return tag, registry


def render_template(root: Path, name: str, values: dict[str, str]) -> str:
    path = root / ".claude" / "templates" / name
    text = read_text(path)
    for key, value in values.items():
        text = text.replace("{{" + key + "}}", value)
    remaining = PLACEHOLDER_RE.findall(text)
    if remaining:
        raise ProfileError(f"unresolved template fields in {name}: {', '.join(remaining)}")
    return text


def initialize_log(title: str, target: str, action: str) -> str:
    return (
        f"# {title} Update Log\n\n"
        f"## {today()}\n\n"
        f"* **Initialization**: {action} [{target}]({target}).\n"
    )


def new_research(root: Path, args: argparse.Namespace) -> Path:
    existing_issues = validate(root)
    if existing_issues:
        raise RuntimeError(
            "cannot generate research in an invalid bundle:\n" + format_issues(existing_issues)
        )
    with AllocationLock(root):
        original_registry = load_registry(root)
        roadmap_path = root / "Roadmap" / "roadmap.md"
        original_roadmap = read_text(roadmap_path)
        tag, registry = allocate_tag(root, "RS")
        slug = args.slug or slugify(args.title)
        target = root / "Research" / f"{tag}-{slug}"
        if target.exists():
            raise RuntimeError(f"target already exists: {target}")
        staging = Path(tempfile.mkdtemp(prefix=".okf-staging-", dir=root))
        candidate = staging / target.name
        moved = False
        try:
            for name in ("sources", "notes", "outputs"):
                (candidate / name).mkdir(parents=True, exist_ok=True)
            values = {
                "TITLE": args.title,
                "TITLE_JSON": json.dumps(args.title, ensure_ascii=False),
                "DESCRIPTION_JSON": json.dumps(args.objective, ensure_ascii=False),
                "TIMESTAMP_JSON": json.dumps(utc_now()),
                "TAG_JSON": json.dumps(tag),
                "OBJECTIVE": args.objective,
                "WHY_NOW": args.why_now,
                "SCOPE_IN": args.scope_in,
                "SCOPE_OUT": args.scope_out,
                "DELIVERABLE": args.deliverable,
                "SUCCESS_CRITERIA": args.success_criteria,
            }
            write_text_if_changed(
                candidate / "topic.md",
                render_template(root, "research-topic.md.tmpl", values),
            )
            write_text_if_changed(
                candidate / "log.md",
                initialize_log(args.title, "topic.md", "Created research topic"),
            )
            for name in ("sources", "notes", "outputs"):
                write_text_if_changed(
                    candidate / name / "index.md",
                    f"# {name.title()}\n\nNo concepts have been added yet.\n",
                )
            write_text_if_changed(candidate / "index.md", render_index(root, candidate))
            os.replace(candidate, target)
            moved = True
            save_registry(root, registry)
            sync_master_roadmap(root)
            sync_indexes(root)
            issues = validate(root)
            if issues:
                raise RuntimeError(format_issues(issues))
            return target
        except Exception:
            if moved and target.exists():
                shutil.rmtree(target)
                save_registry(root, original_registry)
                write_text_if_changed(roadmap_path, original_roadmap)
                sync_indexes(root)
            raise
        finally:
            shutil.rmtree(staging, ignore_errors=True)


def find_item_dir(root: Path, tag: str) -> Path:
    try:
        domain = DOMAIN_BY_PREFIX[tag.split("-")[0]]
    except KeyError as exc:
        raise ValueError(f"unknown tag prefix in {tag!r}") from exc
    matches = [
        directory
        for directory in domain_item_dirs(root, domain)
        if item_tag(directory.name) == tag
    ]
    if len(matches) != 1:
        raise ValueError(f"tag {tag!r} does not resolve to exactly one {domain.label} item")
    return matches[0]


def find_concept_link(root: Path, tag: str) -> str:
    directory = find_item_dir(root, tag)
    domain = DOMAIN_BY_PREFIX[tag.split("-")[0]]
    concept = directory / domain.concept_file
    if not concept.is_file():
        raise ValueError(f"tag {tag!r} has no {domain.concept_file}")
    return "/" + relative(root, concept)


def find_research_link(root: Path, tag: str) -> str:
    return find_concept_link(root, tag)


def new_roadmap(root: Path, args: argparse.Namespace) -> Path:
    existing_issues = validate(root)
    if existing_issues:
        raise RuntimeError(
            "cannot generate a roadmap item in an invalid bundle:\n"
            + format_issues(existing_issues)
        )
    with AllocationLock(root):
        original_registry = load_registry(root)
        roadmap_path = root / "Roadmap" / "roadmap.md"
        original_roadmap = read_text(roadmap_path)
        tag, registry = allocate_tag(root, "RM")
        slug = args.slug or slugify(args.title)
        target = root / "Roadmap" / f"{tag}-{slug}"
        if target.exists():
            raise RuntimeError(f"target already exists: {target}")
        staging = Path(tempfile.mkdtemp(prefix=".okf-staging-", dir=root))
        candidate = staging / target.name
        moved = False
        try:
            candidate.mkdir(parents=True)
            milestones = args.milestone or [
                "Define the implementation boundary.",
                "Complete the planned work.",
                "Verify the acceptance criteria.",
            ]
            milestone_text = "\n".join(f"- [ ] {item}" for item in milestones)
            research_links = (
                "\n".join(
                    f"- [{research_tag}]({find_research_link(root, research_tag)})"
                    for research_tag in args.research
                )
                or "No linked research yet."
            )
            values = {
                "TITLE": args.title,
                "TITLE_JSON": json.dumps(args.title, ensure_ascii=False),
                "DESCRIPTION_JSON": json.dumps(args.goal, ensure_ascii=False),
                "TIMESTAMP_JSON": json.dumps(utc_now()),
                "TAG_JSON": json.dumps(tag),
                "GOAL": args.goal,
                "WHY_IT_MATTERS": args.why_it_matters,
                "MILESTONES": milestone_text,
                "LINKED_RESEARCH": research_links,
            }
            write_text_if_changed(
                candidate / "item.md",
                render_template(root, "roadmap-item.md.tmpl", values),
            )
            write_text_if_changed(
                candidate / "log.md",
                initialize_log(args.title, "item.md", "Created roadmap item"),
            )
            write_text_if_changed(candidate / "index.md", render_index(root, candidate))
            os.replace(candidate, target)
            moved = True
            save_registry(root, registry)
            sync_master_roadmap(root)
            sync_indexes(root)
            issues = validate(root)
            if issues:
                raise RuntimeError(format_issues(issues))
            return target
        except Exception:
            if moved and target.exists():
                shutil.rmtree(target)
                save_registry(root, original_registry)
                write_text_if_changed(roadmap_path, original_roadmap)
                sync_indexes(root)
            raise
        finally:
            shutil.rmtree(staging, ignore_errors=True)


INCREMENT_PLACEHOLDER = "No delivered increments have been recorded yet."
SCAN_SUFFIXES = frozenset(
    {".md", ".json", ".toml", ".yml", ".yaml", ".py", ".txt", ".cfg", ".ini", ".sh"}
)
SCAN_SKIP_DIRS = SKIP_DIRS | {
    "node_modules",
    "dist",
    "build",
    "site-packages",
    ".mypy_cache",
    ".ruff_cache",
    ".pytest_cache",
    ".idea",
    ".vscode",
}
MAX_SCAN_BYTES = 2 * 1024 * 1024


@dataclass(frozen=True)
class StaleReference:
    path: str
    line: int
    text: str
    suggestion: str


@dataclass(frozen=True)
class CompletionResult:
    destination: Path
    repointed: tuple[str, ...]
    documented: tuple[str, ...]
    milestones_ticked: int
    ledger_waived: bool
    stale_references: tuple[StaleReference, ...]


class TextRestore:
    """Capture file contents so a failed transaction can put them back verbatim."""

    def __init__(self) -> None:
        self._originals: list[tuple[Path, Optional[str]]] = []

    def capture(self, path: Path) -> None:
        self._originals.append((path, read_text(path) if path.is_file() else None))

    def restore(self) -> None:
        for path, text in reversed(self._originals):
            if text is None:
                path.unlink(missing_ok=True)
            elif not path.is_file() or read_text(path) != text:
                # Bypasses write_text_if_changed so trailing whitespace survives.
                _atomic_write(path, text)


def new_docu(root: Path, args: argparse.Namespace) -> Path:
    existing_issues = validate(root)
    if existing_issues:
        raise RuntimeError(
            "cannot generate a documentation subject in an invalid bundle:\n"
            + format_issues(existing_issues)
        )
    with AllocationLock(root):
        original_registry = load_registry(root)
        roadmap_path = root / "Roadmap" / "roadmap.md"
        original_roadmap = read_text(roadmap_path)
        tag, registry = allocate_tag(root, "DC")
        slug = args.slug or slugify(args.title)
        target = root / DOCU_ROOT / f"{tag}-{slug}"
        if not (root / DOCU_ROOT).is_dir():
            raise RuntimeError(
                f"{DOCU_ROOT}/ does not exist yet; create it and run sync-indexes"
            )
        if target.exists():
            raise RuntimeError(f"target already exists: {target}")
        staging = Path(tempfile.mkdtemp(prefix=".okf-staging-", dir=root))
        candidate = staging / target.name
        moved = False
        try:
            candidate.mkdir(parents=True)
            code_locations = (
                "\n".join(f"- `{location}`" for location in args.code_location)
                or "Not recorded yet."
            )
            values = {
                "TITLE": args.title,
                "TITLE_JSON": json.dumps(args.title, ensure_ascii=False),
                "DESCRIPTION_JSON": json.dumps(args.subject, ensure_ascii=False),
                "TIMESTAMP_JSON": json.dumps(utc_now()),
                "TAG_JSON": json.dumps(tag),
                "SUBJECT": args.subject,
                "SCOPE_IN": args.scope_in,
                "SCOPE_OUT": args.scope_out,
                "CODE_LOCATIONS": code_locations,
                "INCREMENT_PLACEHOLDER": INCREMENT_PLACEHOLDER,
            }
            write_text_if_changed(
                candidate / "doc.md",
                render_template(root, "documentation.md.tmpl", values),
            )
            write_text_if_changed(
                candidate / "log.md",
                initialize_log(args.title, "doc.md", "Created documentation subject"),
            )
            write_text_if_changed(candidate / "index.md", render_index(root, candidate))
            os.replace(candidate, target)
            moved = True
            save_registry(root, registry)
            sync_master_roadmap(root)
            sync_indexes(root)
            issues = validate(root)
            if issues:
                raise RuntimeError(format_issues(issues))
            return target
        except Exception:
            if moved and target.exists():
                shutil.rmtree(target)
                save_registry(root, original_registry)
                write_text_if_changed(roadmap_path, original_roadmap)
                sync_indexes(root)
            raise
        finally:
            shutil.rmtree(staging, ignore_errors=True)


def tick_milestones(body: str) -> tuple[str, int]:
    """Tick unchecked boxes inside the Milestones section only."""
    lines = body.splitlines()
    start = next(
        (index for index, line in enumerate(lines) if line.strip() == MILESTONES_HEADING),
        None,
    )
    if start is None:
        return body, 0
    end = next(
        (index for index in range(start + 1, len(lines)) if lines[index].startswith("## ")),
        len(lines),
    )
    ticked = 0
    for index in range(start + 1, end):
        replaced, count = re.subn(r"^(\s*)- \[ \] ", r"\1- [x] ", lines[index])
        if count:
            lines[index] = replaced
            ticked += count
    return "\n".join(lines), ticked


def render_increment(
    tag: str,
    title: str,
    link: str,
    date: str,
    shipped: str,
    deviations: list[str],
    gaps: list[str],
    code_paths: list[str],
) -> str:
    locations = [f"- `{path}`" for path in code_paths] or ["- Not recorded."]
    return "\n".join(
        [
            f"### {tag} — {title}",
            "",
            f"Completed {date}. Roadmap item: [{tag}]({link}).",
            "",
            f"**Shipped:** {shipped}",
            "",
            "**Planned vs delivered:** "
            + ("; ".join(deviations) if deviations else "Delivered as planned."),
            "",
            "**Known gaps:** " + ("; ".join(gaps) if gaps else "None."),
            "",
            "**Where the code lives:**",
            "",
            *locations,
        ]
    )


def insert_increment(body: str, tag: str, block: str) -> str:
    """Splice an increment into the section in ascending tag order."""
    spans = delivered_increments(body)
    if spans is None:
        raise ProfileError(f"document has no '{DELIVERED_HEADING}' section")
    if tag in spans:
        raise ValueError(f"{tag} is already recorded as a delivered increment")
    lines = body.splitlines()
    start = next(index for index, line in enumerate(lines) if line.strip() == DELIVERED_HEADING)
    end = next(
        (index for index in range(start + 1, len(lines)) if lines[index].startswith("## ")),
        len(lines),
    )
    heads = [index for index in range(start + 1, end) if INCREMENT_RE.match(lines[index])]
    first_head = heads[0] if heads else end
    preamble = [
        line
        for line in lines[start + 1 : first_head]
        if line.strip() and line.strip() != INCREMENT_PLACEHOLDER
    ]
    bounds = heads + [end]
    blocks = [lines[a:b] for a, b in zip(bounds, bounds[1:])]
    tags = [
        normalize_tag(INCREMENT_RE.match(entry[0]).group(1), "RM")  # type: ignore[union-attr]
        for entry in blocks
    ]
    position = next(
        (index for index, existing in enumerate(tags) if existing > tag), len(blocks)
    )
    blocks.insert(position, block.splitlines())

    rendered: list[str] = []
    for entry in blocks:
        trimmed = list(entry)
        while trimmed and not trimmed[-1].strip():
            trimmed.pop()
        rendered.extend(trimmed)
        rendered.append("")
    section = [lines[start], ""]
    if preamble:
        section.extend(preamble + [""])
    section.extend(rendered)
    while section and not section[-1].strip():
        section.pop()
    tail = ([""] + lines[end:]) if end < len(lines) else []
    return "\n".join(lines[:start] + section + tail)


def append_log_entry(text: str, bullet: str) -> str:
    """Add a bullet under today's heading, preserving newest-first ordering."""
    lines = text.splitlines()
    stamp = today()
    first = next(
        (index for index, line in enumerate(lines) if DATE_RE.fullmatch(line.strip())),
        None,
    )
    if first is None:
        return "\n".join(lines + ["", f"## {stamp}", "", bullet])
    if lines[first].strip() == f"## {stamp}":
        stop = next(
            (
                index
                for index in range(first + 1, len(lines))
                if DATE_RE.fullmatch(lines[index].strip())
            ),
            len(lines),
        )
        while stop > first + 1 and not lines[stop - 1].strip():
            stop -= 1
        return "\n".join(lines[:stop] + [bullet] + lines[stop:])
    return "\n".join(lines[:first] + [f"## {stamp}", "", bullet, ""] + lines[first:])


def discover_status_ledgers(root: Path, explicit: list[str]) -> list[Path]:
    """Every work-package ledger in the bundle, or the ones named explicitly."""
    if explicit:
        return [
            candidate if candidate.is_absolute() else root / candidate
            for candidate in (Path(value) for value in explicit)
        ]
    # One ledger per roadmap item: Roadmap/RM-NN-slug/STATUS.md, and the same
    # under Roadmap/completed/ so a re-run can still find a retired item's.
    return sorted(root.glob("Roadmap/RM-*/STATUS.md")) + sorted(
        root.glob(f"{COMPLETED_ROOT}/RM-*/STATUS.md")
    )


def ledger_gate(ledgers: list[Path], tag: str) -> tuple[list[str], bool]:
    """Return blocking messages, and whether a ledger was found for this item.

    A ledger belongs to the item whose folder holds it. A work package counts as
    finished only when its box is ticked, so any unticked box refuses the
    completion — the same teeth the task board gave, on the format /next-wp
    already maintains.
    """
    problems: list[str] = []
    matched = False
    for ledger_path in ledgers:
        if not ledger_path.parent.name.startswith(f"{tag}-"):
            continue
        try:
            text = read_text(ledger_path)
        except OSError as exc:
            problems.append(f"{ledger_path}: unreadable status ledger: {exc}")
            continue
        matched = True
        _, body = parse_frontmatter_safe(text)
        open_boxes = [
            line.strip()
            for line in body.splitlines()
            if LEDGER_OPEN_RE.match(line)
        ]
        if open_boxes:
            problems.append(
                f"{ledger_path}: {len(open_boxes)} work package(s) are not done:\n  "
                + "\n  ".join(open_boxes[:20])
                + ("\n  ..." if len(open_boxes) > 20 else "")
            )
    return problems, matched


def parse_frontmatter_safe(text: str) -> tuple[Optional[dict[str, Any]], str]:
    """parse_frontmatter, but a malformed header is not fatal to the gate."""
    try:
        return parse_frontmatter(text)
    except ProfileError:
        return None, text


def stale_reference_report(
    root: Path, old_rel: str, new_rel: str, scan_root: Path
) -> list[StaleReference]:
    """Read-only scan for text still pointing at a moved item. Never writes."""
    needles = sorted(
        {
            f"{root.name}/{old_rel}": f"{root.name}/{new_rel}",
            f"/{old_rel}": f"/{new_rel}",
            old_rel: new_rel,
        }.items(),
        key=lambda pair: -len(pair[0]),
    )
    moved = root / new_rel
    found: list[StaleReference] = []
    for current, dirs, files in os.walk(scan_root):
        dirs[:] = sorted(name for name in dirs if name not in SCAN_SKIP_DIRS)
        here = Path(current)
        if here == moved or moved in here.parents:
            dirs[:] = []
            continue
        for name in sorted(files):
            path = here / name
            if path.suffix.lower() not in SCAN_SUFFIXES:
                continue
            try:
                if path.stat().st_size > MAX_SCAN_BYTES:
                    continue
                text = path.read_text(encoding="utf-8")
            except (OSError, UnicodeDecodeError):
                continue
            for number, line in enumerate(text.splitlines(), start=1):
                for old, new in needles:
                    if old in line and new not in line:
                        found.append(
                            StaleReference(
                                str(path),
                                number,
                                line.strip(),
                                line.strip().replace(old, new),
                            )
                        )
                        break
    return found


def dirty_tree_paths(root: Path) -> Optional[list[str]]:
    """Uncommitted paths under root, or None when git cannot answer."""
    try:
        result = subprocess.run(
            ["git", "status", "--porcelain", "--", str(root)],
            cwd=root,
            capture_output=True,
            text=True,
            timeout=15,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if result.returncode != 0:
        return None
    return [line for line in result.stdout.splitlines() if line.strip()]


def split_link_target(raw: str) -> tuple[str, str]:
    """Split a Markdown link target into its path and everything after it."""
    stripped = raw.strip()
    parts = stripped.split(maxsplit=1)
    head = parts[0]
    trailer = f" {parts[1]}" if len(parts) > 1 else ""
    for separator in ("#", "?"):
        index = head.find(separator)
        if index != -1:
            return head[:index], head[index:] + trailer
    return head, trailer


def project_link_rewrites(
    root: Path, source: Path, destination: Path, projected: dict[Path, str]
) -> dict[Path, str]:
    """Re-point bundle Markdown links from a moved item folder to its new home.

    The move is what breaks these links, so the same transaction repairs them.
    index.md is skipped because sync_indexes regenerates it; log.md is rewritten
    but carries no frontmatter, so it needs no timestamp bump.
    """
    merged = dict(projected)
    for path in markdown_files(root):
        if path == source or source in path.parents or path.name == "index.md":
            continue
        try:
            text = merged.get(path) or read_text(path)
        except (OSError, UnicodeDecodeError):
            continue

        def repoint(match: "re.Match[str]") -> str:
            raw = match.group(1)
            head, trailer = split_link_target(raw)
            target = resolve_link(root, path, head)
            if target is None:
                return match.group(0)
            normalized = Path(os.path.normpath(target))
            if normalized != source and source not in normalized.parents:
                return match.group(0)
            moved = destination / normalized.relative_to(source)
            if head.startswith("/"):
                replacement = "/" + relative(root, moved)
            else:
                replacement = os.path.relpath(moved, path.parent).replace(os.sep, "/")
            return match.group(0).replace(raw, replacement + trailer, 1)

        updated = LINK_RE.sub(repoint, text)
        if updated == text:
            continue
        if path.name in RESERVED_NAMES:
            merged[path] = updated
            continue
        metadata, body = parse_frontmatter(updated)
        if metadata is None:
            merged[path] = updated
            continue
        previous, _ = parse_frontmatter(read_text(path)) if path.is_file() else (None, "")
        metadata["timestamp"] = advance_timestamp(
            (previous or {}).get("timestamp") if previous else None
        )
        merged[path] = render_frontmatter(metadata, body)
    return merged


def complete_roadmap(root: Path, args: argparse.Namespace) -> CompletionResult:
    """Move a finished roadmap item to Roadmap/completed/ and record its delivery."""
    existing_issues = validate(root)
    if existing_issues:
        raise RuntimeError(
            "cannot complete a roadmap item in an invalid bundle:\n"
            + format_issues(existing_issues)
        )

    tag = normalize_tag(args.tag, "RM")
    source = find_item_dir(root, tag)
    if source.parent.name == "completed":
        raise RuntimeError(f"{tag} is already completed")
    item_path = source / "item.md"
    item_metadata, item_body = parse_frontmatter(read_text(item_path))
    if item_metadata is None:
        raise ProfileError(f"{relative(root, item_path)} has no frontmatter")
    if item_metadata.get("status") == "done":
        raise RuntimeError(f"{tag} is already marked done")

    completed_root = root / COMPLETED_ROOT
    if not completed_root.is_dir():
        raise RuntimeError(
            f"{COMPLETED_ROOT}/ does not exist yet; create it and run sync-indexes"
        )
    destination = completed_root / source.name
    if destination.exists():
        raise RuntimeError(f"destination already exists: {destination}")

    ledgers = discover_status_ledgers(root, args.ledger or [])
    problems, matched = ledger_gate(ledgers, tag)
    if problems:
        raise RuntimeError(
            "refusing to complete; the work-package ledger is not finished:\n"
            + "\n".join(problems)
        )
    if not matched and not args.no_ledger:
        raise RuntimeError(
            f"no STATUS.md ledger was found for {tag}; "
            "pass --no-ledger to complete without one"
        )

    if not args.no_scan and args.require_clean_tree:
        dirty = dirty_tree_paths(root)
        if dirty:
            raise RuntimeError(
                "refusing to complete with uncommitted changes under the bundle:\n"
                + "\n".join(dirty)
            )

    doc_paths: list[Path] = []
    for value in args.docu:
        doc_tag = normalize_tag(value, "DC")
        doc_dir = find_item_dir(root, doc_tag)
        doc_path = doc_dir / "doc.md"
        metadata, body = parse_frontmatter(read_text(doc_path))
        if metadata is None:
            raise ProfileError(f"{relative(root, doc_path)} has no frontmatter")
        if metadata.get("status") in {"superseded", "archived"}:
            raise RuntimeError(f"{doc_tag} is {metadata['status']} and cannot record work")
        spans = delivered_increments(body)
        if spans is None:
            raise ProfileError(
                f"{relative(root, doc_path)} has no '{DELIVERED_HEADING}' section"
            )
        if tag in spans:
            raise RuntimeError(f"{doc_tag} already records {tag}")
        doc_paths.append(doc_path)
    if not doc_paths:
        raise ValueError("at least one --docu target is required")

    # ---- render everything before touching the tree -------------------------
    new_item_body, ticked = (
        (item_body, 0) if args.keep_milestones else tick_milestones(item_body)
    )
    new_item_metadata = dict(item_metadata)
    new_item_metadata["status"] = "done"
    new_item_metadata["timestamp"] = advance_timestamp(item_metadata.get("timestamp"))
    if new_item_metadata["timestamp"] == item_metadata.get("timestamp"):
        raise ProfileError("item.md timestamp was not advanced")
    new_item_text = render_frontmatter(new_item_metadata, new_item_body)

    title = str(item_metadata.get("title", tag))
    link = "/" + relative(root, destination / "item.md")
    increment = render_increment(
        tag,
        title,
        link,
        today(),
        args.shipped,
        args.deviation or [],
        args.gap or [],
        args.code_path or [],
    )

    projected: dict[Path, str] = {destination / "item.md": new_item_text}
    documented: list[str] = []
    doc_logs: dict[Path, str] = {}
    for doc_path in doc_paths:
        metadata, body = parse_frontmatter(read_text(doc_path))
        assert metadata is not None
        new_metadata = dict(metadata)
        new_metadata["timestamp"] = advance_timestamp(metadata.get("timestamp"))
        if args.docu_status:
            new_metadata["status"] = args.docu_status
        projected[doc_path] = render_frontmatter(
            new_metadata, insert_increment(body, tag, increment)
        )
        documented.append(item_tag(doc_path.parent.name) or doc_path.parent.name)
        doc_logs[doc_path.parent / "log.md"] = append_log_entry(
            read_text(doc_path.parent / "log.md"),
            f"* **Increment**: Recorded {tag} delivery in [doc.md](doc.md).",
        )

    waiver = " (task board waived)" if not matched else ""
    summary = args.summary or (
        f"Marked done, moved to {COMPLETED_ROOT}/, documented in "
        f"{', '.join(documented)}. {ticked} milestone(s) ticked.{waiver}"
    )
    new_rm_log = append_log_entry(read_text(source / "log.md"), f"* **Completion**: {summary}")

    projected = project_link_rewrites(root, source, destination, projected)
    repointed = [
        path
        for path in projected
        if path != destination / "item.md" and path not in doc_paths
    ]

    profile = load_profile(root)
    for path, content in projected.items():
        if path.is_file():
            # Held to exactly the standard an agent's own Write is held to,
            # including the PROFILE028 timestamp rule.
            replay = hook_pre(
                root,
                {
                    "tool_name": "Write",
                    "tool_input": {"file_path": str(path), "content": content},
                },
            )
        else:
            # The destination does not exist yet, so hook_pre would skip
            # PROFILE028; the timestamp is asserted explicitly above.
            replay = path_policy_issues(root, path)
            replay.extend(validate_projected_document(root, path, content, profile))
        if replay:
            raise RuntimeError(format_issues(replay))

    # ---- commit -------------------------------------------------------------
    with AllocationLock(root):
        roadmap_path = root / "Roadmap" / "roadmap.md"
        restore = TextRestore()
        restore.capture(roadmap_path)
        restore.capture(item_path)
        restore.capture(source / "log.md")
        for doc_path in doc_paths:
            restore.capture(doc_path)
            restore.capture(doc_path.parent / "log.md")
        for path in repointed:
            restore.capture(path)

        moved = False
        try:
            os.replace(source, destination)
            moved = True
            write_text_if_changed(destination / "item.md", new_item_text)
            write_text_if_changed(destination / "log.md", new_rm_log)
            for doc_path in doc_paths:
                write_text_if_changed(doc_path, projected[doc_path])
            for log_path, content in doc_logs.items():
                write_text_if_changed(log_path, content)
            for path in repointed:
                write_text_if_changed(path, projected[path])
            sync_master_roadmap(root)
            sync_indexes(root)
            issues = validate(root)
            if issues:
                raise RuntimeError(format_issues(issues))
        except Exception:
            try:
                # Undo the move first: the restore map uses pre-move paths.
                if moved and destination.exists() and not source.exists():
                    os.replace(destination, source)
                restore.restore()
                sync_indexes(root)
            except Exception as rollback_exc:
                print(
                    f"FATAL: rollback failed: {rollback_exc}\n"
                    "The bundle may be inconsistent. Recover with:\n"
                    f"  git checkout -- {root}\n"
                    f"  python3 .claude/scripts/okf.py --root {root} sync-indexes",
                    file=sys.stderr,
                )
            raise

    stale: list[StaleReference] = []
    if not args.no_scan:
        scan_root = Path(args.scan_root).resolve() if args.scan_root else root.parent
        stale = stale_reference_report(
            root, relative(root, source), relative(root, destination), scan_root
        )
    return CompletionResult(
        destination=destination,
        repointed=tuple(sorted(relative(root, path) for path in repointed)),
        documented=tuple(documented),
        milestones_ticked=ticked,
        ledger_waived=not matched,
        stale_references=tuple(stale),
    )


def print_stale_references(stale: list[StaleReference], tag: str) -> None:
    if not stale:
        return
    print(
        f"\nWARNING: {len(stale)} reference(s) still point at the old path.\n"
        "This tool never edits outside --root. Apply these yourself:",
        file=sys.stderr,
    )
    for entry in stale:
        print(f"  {entry.path}:{entry.line}", file=sys.stderr)
        print(f"      {entry.text}", file=sys.stderr)
        print(f"   -> {entry.suggestion}", file=sys.stderr)
    print(f"Re-run to confirm:  okf.py check-references --tag {tag}", file=sys.stderr)


def check_references(root: Path, args: argparse.Namespace) -> int:
    tag = normalize_tag(args.tag, "RM")
    directory = find_item_dir(root, tag)
    if directory.parent.name != "completed":
        # Nothing has moved, so there is no old path anything could still name.
        print(f"{tag} has not been completed; there is nothing to re-point.")
        return 0
    new_rel = relative(root, directory)
    old_rel = f"Roadmap/{directory.name}"
    scan_root = Path(args.scan_root).resolve() if args.scan_root else root.parent
    stale = stale_reference_report(root, old_rel, new_rel, scan_root)
    if not stale:
        print(f"No stale references to {tag}.")
        return 0
    print_stale_references(stale, tag)
    return 3


def format_issues(issues: list[Issue]) -> str:
    return "\n".join(
        f"{issue.layer.upper()} {issue.code} {issue.path}: {issue.message}"
        for issue in issues
    )


def print_validation(root: Path, as_json: bool = False) -> int:
    issues = validate(root)
    okf_issues = [issue for issue in issues if issue.layer == "okf"]
    profile_issues = [issue for issue in issues if issue.layer == "profile"]
    if as_json:
        print(
            json.dumps(
                {
                    "okf_version": "0.1",
                    "okf_conformant": not okf_issues,
                    "profile_conformant": not issues,
                    "issues": [issue.as_dict() for issue in issues],
                },
                indent=2,
            )
        )
    else:
        print(f"OKF v0.1 conformance: {'PASS' if not okf_issues else 'FAIL'}")
        print(
            "Research Scaffold OKF Profile: "
            + ("PASS" if not issues else "FAIL")
        )
        if issues:
            print(format_issues(issues))
    return 0 if not issues else 1


def status(root: Path) -> int:
    rows: list[tuple[str, str, str, str, str]] = []
    for domain in DOMAINS:
        for directory in domain_item_dirs(root, domain):
            concept = directory / domain.concept_file
            if not concept.is_file():
                continue
            metadata = concept_metadata(concept)
            rows.append(
                (
                    item_tag(directory.name) or directory.name,
                    domain.label,
                    str(metadata.get("title", "")),
                    str(metadata.get("status", "")),
                    "completed" if directory.parent.name == "completed" else "active",
                )
            )
    print("| Tag | Domain | Title | Status | Location |")
    print("| --- | --- | --- | --- | --- |")
    if not rows:
        print("| — | — | Nothing has been created yet | — | — |")
    else:
        for row in rows:
            print("| " + " | ".join(row) + " |")
    return 0


def validate_projected_document(
    root: Path, path: Path, content: str, profile: dict[str, Any]
) -> list[Issue]:
    if path.suffix != ".md":
        return []
    rel = relative(root, path)
    if path.name.lower() == "readme.md":
        return [Issue("profile", "PROFILE025", rel, "use index.md instead of README.md")]
    if path.name == "index.md":
        return validate_index(root, path, content)
    if path.name == "log.md":
        return validate_log(root, path, content)
    return validate_concept(root, path, content, profile)[0]


def projected_edit(
    path: Path, tool_name: str, tool_input: dict[str, Any]
) -> Optional[str]:
    if tool_name == "Write":
        return tool_input.get("content")
    if not path.exists():
        return None
    content = read_text(path)
    if tool_name == "Edit":
        old = tool_input.get("old_string")
        new = tool_input.get("new_string")
        if not isinstance(old, str) or not isinstance(new, str) or old not in content:
            return None
        return content.replace(old, new, 1)
    if tool_name == "MultiEdit":
        for edit in tool_input.get("edits", []):
            old = edit.get("old_string")
            new = edit.get("new_string")
            if not isinstance(old, str) or not isinstance(new, str) or old not in content:
                return None
            content = content.replace(old, new, 1)
        return content
    return None


def path_policy_issues(root: Path, path: Path) -> list[Issue]:
    try:
        rel = relative(root, path)
    except ValueError:
        return []
    parts = Path(rel).parts
    if not parts:
        return []
    if parts[0] == "tools" and path.suffix.lower() == ".md":
        return [
            Issue(
                "profile",
                "PROFILE031",
                rel,
                "tools/ is scaffold infrastructure and must not contain Markdown",
            )
        ]
    if path.name.lower() == "readme.md":
        return [Issue("profile", "PROFILE025", rel, "use reserved index.md instead")]

    def item_ok(domain: Domain, name: str) -> bool:
        # startswith before fullmatch, so 'RM-1-x' still fails rather than
        # slipping through as an unrecognized directory.
        return name.startswith(domain.prefix + "-") and bool(TAG_DIR_RE.fullmatch(name))

    research = DOMAIN_BY_PREFIX["RS"]
    if parts[0] == "Research":
        if len(parts) == 2 and parts[1] in research.loose_files:
            return []
        if len(parts) >= 3 and item_ok(research, parts[1]):
            return []
        return [Issue("profile", research.path_code, rel, research.path_message)]

    roadmap = DOMAIN_BY_PREFIX["RM"]
    if parts[0] == "Roadmap":
        if len(parts) == 2 and parts[1] in roadmap.loose_files:
            return []
        if len(parts) == 3 and parts[1] == "completed" and parts[2] == "index.md":
            return []
        if len(parts) >= 3 and item_ok(roadmap, parts[1]):
            return []
        if len(parts) >= 4 and parts[1] == "completed" and item_ok(roadmap, parts[2]):
            return []
        return [Issue("profile", roadmap.path_code, rel, roadmap.path_message)]

    documentation = DOMAIN_BY_PREFIX["DC"]
    if parts[0] == DOCU_ROOT:
        if len(parts) == 2 and parts[1] in documentation.loose_files:
            return []
        if len(parts) >= 3 and item_ok(documentation, parts[1]):
            return []
        return [Issue("profile", documentation.path_code, rel, documentation.path_message)]
    return []


def hook_pre(root: Path, payload: dict[str, Any]) -> list[Issue]:
    tool_name = payload.get("tool_name", "")
    if tool_name not in {"Write", "Edit", "MultiEdit", "NotebookEdit"}:
        return []
    tool_input = payload.get("tool_input") or {}
    raw_path = tool_input.get("file_path") or tool_input.get("notebook_path")
    if not raw_path:
        return []
    path = Path(raw_path)
    if not path.is_absolute():
        path = root / path
    path = Path(os.path.normpath(path))
    issues = path_policy_issues(root, path)
    projected = projected_edit(path, tool_name, tool_input)
    if projected is not None:
        issues.extend(validate_projected_document(root, path, projected, load_profile(root)))
        if (
            tool_name in {"Write", "Edit", "MultiEdit"}
            and path.is_file()
            and path.suffix == ".md"
            and path.name not in RESERVED_NAMES
        ):
            try:
                old_metadata, old_body = parse_frontmatter(read_text(path))
                new_metadata, new_body = parse_frontmatter(projected)
            except ProfileError:
                old_metadata = new_metadata = None
                old_body = new_body = ""
            if old_metadata and new_metadata:
                old_without_timestamp = {
                    key: value for key, value in old_metadata.items() if key != "timestamp"
                }
                new_without_timestamp = {
                    key: value for key, value in new_metadata.items() if key != "timestamp"
                }
                meaning_changed = (
                    old_body != new_body or old_without_timestamp != new_without_timestamp
                )
                if meaning_changed and old_metadata.get("timestamp") == new_metadata.get("timestamp"):
                    issues.append(
                        Issue(
                            "profile",
                            "PROFILE028",
                            relative(root, path),
                            "meaningful concept edits must update timestamp in the same operation",
                        )
                    )
    return issues


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=project_root_from_script())
    subparsers = parser.add_subparsers(dest="command", required=True)

    validate_parser = subparsers.add_parser("validate")
    validate_parser.add_argument("--json", action="store_true")
    subparsers.add_parser("sync-indexes")
    subparsers.add_parser("status")
    subparsers.add_parser("hook-pre")

    research = subparsers.add_parser("new-research")
    research.add_argument("--title", required=True)
    research.add_argument("--objective", required=True)
    research.add_argument("--why-now", required=True)
    research.add_argument("--scope-in", required=True)
    research.add_argument("--scope-out", required=True)
    research.add_argument("--deliverable", required=True)
    research.add_argument("--success-criteria", required=True)
    research.add_argument("--slug")

    roadmap = subparsers.add_parser("new-roadmap")
    roadmap.add_argument("--title", required=True)
    roadmap.add_argument("--goal", required=True)
    roadmap.add_argument("--why-it-matters", required=True)
    roadmap.add_argument("--milestone", action="append", default=[])
    roadmap.add_argument("--research", action="append", default=[])
    roadmap.add_argument("--slug")

    docu = subparsers.add_parser("new-docu")
    docu.add_argument("--title", required=True)
    docu.add_argument("--subject", required=True)
    docu.add_argument("--scope-in", required=True)
    docu.add_argument("--scope-out", required=True)
    docu.add_argument("--code-location", action="append", default=[])
    docu.add_argument("--slug")

    complete = subparsers.add_parser("complete-roadmap")
    complete.add_argument("--tag", required=True)
    complete.add_argument("--docu", action="append", default=[], required=True)
    complete.add_argument("--shipped", required=True)
    complete.add_argument("--deviation", action="append", default=[])
    complete.add_argument("--gap", action="append", default=[])
    complete.add_argument("--code-path", action="append", default=[])
    complete.add_argument("--summary")
    complete.add_argument("--ledger", action="append", default=[])
    complete.add_argument("--no-ledger", action="store_true")
    complete.add_argument("--keep-milestones", action="store_true")
    complete.add_argument("--docu-status")
    complete.add_argument("--require-clean-tree", action="store_true")
    complete.add_argument("--scan-root")
    complete.add_argument("--no-scan", action="store_true")
    complete.add_argument("--strict-references", action="store_true")

    references = subparsers.add_parser("check-references")
    references.add_argument("--tag", required=True)
    references.add_argument("--scan-root")
    return parser


def main(argv: Optional[list[str]] = None) -> int:
    args = build_parser().parse_args(argv)
    root = args.root.resolve()
    try:
        if args.command == "validate":
            return print_validation(root, args.json)
        if args.command == "sync-indexes":
            changed = sync_indexes(root)
            changed += int(sync_master_roadmap(root))
            print(f"Synchronized {changed} file(s).")
            return print_validation(root)
        if args.command == "status":
            return status(root)
        if args.command == "hook-pre":
            try:
                payload = json.load(sys.stdin)
            except json.JSONDecodeError as exc:
                print(f"OKF hook rejected an invalid payload: {exc}", file=sys.stderr)
                return 2
            issues = hook_pre(root, payload)
            if issues:
                print(format_issues(issues), file=sys.stderr)
                return 2
            return 0
        if args.command == "new-research":
            target = new_research(root, args)
            print(f"Created {relative(root, target)}")
            return 0
        if args.command == "new-roadmap":
            target = new_roadmap(root, args)
            print(f"Created {relative(root, target)}")
            return 0
        if args.command == "new-docu":
            target = new_docu(root, args)
            print(f"Created {relative(root, target)}")
            return 0
        if args.command == "complete-roadmap":
            result = complete_roadmap(root, args)
            print(
                f"Completed {normalize_tag(args.tag, 'RM')} -> "
                f"{relative(root, result.destination)}"
            )
            print(
                f"Recorded the increment in {', '.join(result.documented)}. "
                f"Ticked {result.milestones_ticked} milestone(s)."
                + (" Ledger waived." if result.ledger_waived else "")
            )
            if result.repointed:
                print(
                    f"Re-pointed {len(result.repointed)} bundle link(s): "
                    + ", ".join(result.repointed)
                )
            print_stale_references(
                list(result.stale_references), normalize_tag(args.tag, "RM")
            )
            if result.stale_references and args.strict_references:
                return 3
            return 0
        if args.command == "check-references":
            return check_references(root, args)
    except (OSError, ValueError, RuntimeError, ProfileError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
