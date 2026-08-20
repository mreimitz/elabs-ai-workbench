#!/usr/bin/env python3
"""Convert one local file or directory into a new, validated RS research topic."""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import mimetypes
import os
import re
import shutil
import sys
import tempfile
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Optional, Protocol

from markitdown_adapter import ConversionError, ConversionResult, MarkItDownAdapter


TOOLS_DIR = Path(__file__).resolve().parent
ROOT = TOOLS_DIR.parent
CORE_PATH = ROOT / ".claude" / "scripts" / "okf.py"
DEFAULT_MAX_FILE_BYTES = 100 * 1024 * 1024
DEFAULT_MAX_TOTAL_BYTES = 500 * 1024 * 1024
DEFAULT_MAX_FILES = 1000
DEFAULT_MAX_ARCHIVE_ENTRIES = 2000
DEFAULT_MAX_ARCHIVE_BYTES = 500 * 1024 * 1024


def load_okf_module() -> Any:
    spec = importlib.util.spec_from_file_location("research_scaffold_okf_runtime", CORE_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load OKF runtime from {CORE_PATH}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


okf = load_okf_module()


class Converter(Protocol):
    def convert_local(self, path: Path) -> ConversionResult:
        ...


@dataclass(frozen=True)
class InputFile:
    source: Path
    relative: Path
    sha256: str
    size: int
    media_type: str


@dataclass(frozen=True)
class ConvertedFile:
    input: InputFile
    markdown: str
    converter: str
    converter_version: str


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def is_hidden(relative_path: Path) -> bool:
    return any(part.startswith(".") for part in relative_path.parts)


def ensure_not_repository_ancestor(root: Path, source: Path) -> None:
    if source.is_dir() and (source == root or source in root.parents):
        raise ValueError("refusing to ingest a directory that contains the project repository")


def visible_directory_files(directory: Path) -> list[tuple[Path, Path]]:
    collected: list[tuple[Path, Path]] = []
    for current, dirs, files in os.walk(directory, followlinks=False):
        current_path = Path(current)
        visible_dirs: list[str] = []
        for name in sorted(dirs):
            candidate = current_path / name
            relative = candidate.relative_to(directory)
            if is_hidden(relative):
                continue
            if candidate.is_symlink():
                raise ValueError(f"symlinked directories are not accepted: {relative}")
            visible_dirs.append(name)
        dirs[:] = visible_dirs
        for name in sorted(files):
            candidate = current_path / name
            relative = candidate.relative_to(directory)
            if is_hidden(relative):
                continue
            if candidate.is_symlink():
                raise ValueError(f"symlinked files are not accepted: {relative}")
            if not candidate.is_file():
                raise ValueError(f"unsupported filesystem entry: {relative}")
            collected.append((candidate, relative))
    return collected


def preflight_zip(path: Path) -> None:
    if not zipfile.is_zipfile(path):
        return
    with zipfile.ZipFile(path) as archive:
        entries = archive.infolist()
        if len(entries) > DEFAULT_MAX_ARCHIVE_ENTRIES:
            raise ValueError(
                f"{path.name} has {len(entries)} archive entries; maximum is "
                f"{DEFAULT_MAX_ARCHIVE_ENTRIES}"
            )
        total = 0
        for entry in entries:
            member = Path(entry.filename)
            if member.is_absolute() or ".." in member.parts:
                raise ValueError(f"{path.name} contains an unsafe archive path")
            if entry.flag_bits & 0x1:
                raise ValueError(f"{path.name} contains encrypted archive entries")
            if entry.compress_size == 0 and entry.file_size > 0:
                raise ValueError(f"{path.name} contains an unsafe zero-size compressed entry")
            if (
                entry.compress_size > 0
                and entry.file_size / entry.compress_size > 200
            ):
                raise ValueError(f"{path.name} contains an unsafe compression ratio")
            total += entry.file_size
        if total > DEFAULT_MAX_ARCHIVE_BYTES:
            raise ValueError(
                f"{path.name} expands to more than "
                f"{DEFAULT_MAX_ARCHIVE_BYTES // (1024 * 1024)} MB"
            )


def collect_inputs(
    root: Path,
    supplied: Path,
    max_files: int = DEFAULT_MAX_FILES,
    max_file_bytes: int = DEFAULT_MAX_FILE_BYTES,
    max_total_bytes: int = DEFAULT_MAX_TOTAL_BYTES,
) -> list[InputFile]:
    unresolved = supplied.expanduser()
    if unresolved.is_symlink():
        raise ValueError("symlink inputs are not accepted")
    source = unresolved.resolve(strict=True)
    ensure_not_repository_ancestor(root.resolve(), source)
    if source.is_file():
        raw_files = [(source, Path(source.name))]
    elif source.is_dir():
        raw_files = visible_directory_files(source)
    else:
        raise ValueError("input must be a regular local file or directory")
    if not raw_files:
        raise ValueError("input directory contains no visible regular files")
    if len(raw_files) > max_files:
        raise ValueError(f"input has {len(raw_files)} files; maximum is {max_files}")

    inputs: list[InputFile] = []
    total = 0
    for path, relative_path in raw_files:
        size = path.stat().st_size
        if size > max_file_bytes:
            raise ValueError(
                f"{relative_path} is larger than {max_file_bytes // (1024 * 1024)} MB"
            )
        total += size
        if total > max_total_bytes:
            raise ValueError(
                f"input exceeds the {max_total_bytes // (1024 * 1024)} MB total limit"
            )
        preflight_zip(path)
        media_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        inputs.append(
            InputFile(
                source=path,
                relative=relative_path,
                sha256=sha256_file(path),
                size=size,
                media_type=media_type,
            )
        )
    return inputs


def existing_hashes(root: Path) -> dict[str, str]:
    hashes: dict[str, str] = {}
    for path in root.glob("Research/RS-*/sources/**/*.md"):
        if path.name == "index.md":
            continue
        try:
            metadata, _ = okf.parse_frontmatter(okf.read_text(path))
        except (OSError, okf.ProfileError):
            continue
        digest = metadata.get("source_sha256") if metadata else None
        if isinstance(digest, str):
            hashes[digest] = okf.relative(root, path)
    return hashes


def convert_all(inputs: Iterable[InputFile], converter: Converter) -> list[ConvertedFile]:
    converted: list[ConvertedFile] = []
    for item in inputs:
        result = converter.convert_local(item.source)
        converted.append(
            ConvertedFile(
                input=item,
                markdown=result.markdown,
                converter=result.converter,
                converter_version=result.converter_version,
            )
        )
    return converted


def safe_segment(value: str, fallback: str = "item") -> str:
    normalized = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    normalized = normalized[:80].strip("-")
    return normalized or fallback


def destination_pair(
    item: InputFile, used_companions: set[str]
) -> tuple[Path, Path]:
    parent_parts = [safe_segment(part, "folder") for part in item.relative.parent.parts if part != "."]
    base = safe_segment(item.relative.stem, "document")
    if base in {"index", "log", "readme"}:
        base += "-source"
    parent = Path(*parent_parts) if parent_parts else Path()
    companion = parent / f"{base}.md"
    if companion.as_posix() in used_companions:
        base += "-" + item.sha256[:8]
        companion = parent / f"{base}.md"
    used_companions.add(companion.as_posix())

    suffix = item.source.suffix.lower()
    if suffix == ".md":
        suffix = ".source"
    elif not re.fullmatch(r"\.[a-z0-9]{1,12}", suffix):
        suffix = ".bin"
    attachment = parent / f"{base}{suffix}"
    return attachment, companion


def source_title(path: Path) -> str:
    value = re.sub(r"[_-]+", " ", path.stem).strip()
    return value.title() or path.name


def source_concept(
    converted: ConvertedFile,
    attachment_name: str,
    ingested_at: str,
) -> str:
    item = converted.input
    format_tag = safe_segment(item.source.suffix.lstrip("."), "file")
    metadata = {
        "type": "Source Reference",
        "title": source_title(item.relative),
        "description": f"Converted content from {item.relative.name}.",
        "resource": f"urn:sha256:{item.sha256}",
        "tags": ["research", "source", "document-intake", format_tag],
        "timestamp": ingested_at,
        "status": "captured",
        "converter": converted.converter,
        "converter_version": converted.converter_version,
        "ingested_at": ingested_at,
        "source_filename": item.relative.name,
        "source_media_type": item.media_type,
        "source_relative_path": item.relative.as_posix(),
        "source_sha256": item.sha256,
        "source_size_bytes": item.size,
    }
    body = "\n".join(
        [
            f"# {source_title(item.relative)}",
            "",
            "## Provenance",
            "",
            f"- Original artifact: [{attachment_name}]({attachment_name})",
            f"- Original relative path: `{item.relative.as_posix()}`",
            f"- SHA-256: `{item.sha256}`",
            f"- Media type: `{item.media_type}`",
            f"- Converter: `{converted.converter} {converted.converter_version}`",
            f"- Ingested: `{ingested_at}`",
            "",
            "## Extracted content",
            "",
            converted.markdown.strip(),
        ]
    )
    return okf.render_frontmatter(metadata, body)


def title_from_user(value: Optional[str]) -> str:
    title = value.strip() if value else ""
    if not title:
        if not sys.stdin.isatty():
            raise ValueError(
                "research entry name is required; pass --title when running non-interactively"
            )
        title = input("What should this research entry be named? ").strip()
    if not title or "\n" in title or len(title) > 160:
        raise ValueError("research entry name must be one line between 1 and 160 characters")
    return title


def render_all_indexes(root: Path, candidate: Path) -> None:
    content_dirs = [
        directory
        for name in ("sources", "notes", "outputs")
        for directory in [candidate / name, *(candidate / name).rglob("*")]
        if directory.is_dir()
    ]
    for directory in sorted(content_dirs, key=lambda path: len(path.parts), reverse=True):
        okf.write_text_if_changed(directory / "index.md", okf.render_index(root, directory))
    okf.write_text_if_changed(candidate / "index.md", okf.render_index(root, candidate))


def publish_research(
    root: Path,
    supplied: Path,
    title: str,
    converted: list[ConvertedFile],
) -> Path:
    original_issues = okf.validate(root)
    if original_issues:
        raise RuntimeError(
            "cannot ingest into an invalid bundle:\n" + okf.format_issues(original_issues)
        )
    ingested_at = okf.utc_now()
    with okf.AllocationLock(root):
        original_registry = okf.load_registry(root)
        roadmap_path = root / "Roadmap" / "roadmap.md"
        original_roadmap = okf.read_text(roadmap_path)
        tag, registry = okf.allocate_tag(root, "RS")
        target = root / "Research" / f"{tag}-{okf.slugify(title)}"
        if target.exists():
            raise RuntimeError(f"target already exists: {target}")
        staging = Path(tempfile.mkdtemp(prefix=".okf-staging-", dir=root))
        candidate = staging / target.name
        moved = False
        try:
            for name in ("sources", "notes", "outputs"):
                (candidate / name).mkdir(parents=True, exist_ok=True)
            scope_label = (
                converted[0].input.relative.name
                if len(converted) == 1
                else f"{len(converted)} files from {supplied.name}"
            )
            topic_values = {
                "TITLE": title,
                "TITLE_JSON": json.dumps(title, ensure_ascii=False),
                "DESCRIPTION_JSON": json.dumps(
                    f"Captured and converted {scope_label} using Microsoft MarkItDown.",
                    ensure_ascii=False,
                ),
                "TIMESTAMP_JSON": json.dumps(ingested_at),
                "TAG_JSON": json.dumps(tag),
                "OBJECTIVE": f"Capture {scope_label} as searchable, traceable Markdown.",
                "WHY_NOW": "The supplied material is being added to the project knowledge base.",
                "SCOPE_IN": f"Content present in {scope_label}.",
                "SCOPE_OUT": "External verification, interpretation, and research synthesis.",
                "DELIVERABLE": "Preserved original artifacts and converted Source Reference concepts.",
                "SUCCESS_CRITERIA": (
                    "Every visible file converts successfully, provenance is recorded, "
                    "and both OKF validation layers pass."
                ),
            }
            okf.write_text_if_changed(
                candidate / "topic.md",
                okf.render_template(root, "research-topic.md.tmpl", topic_values),
            )
            okf.write_text_if_changed(
                candidate / "log.md",
                okf.initialize_log(title, "topic.md", "Created document-intake research topic"),
            )

            used_companions: set[str] = set()
            for result in converted:
                attachment_rel, companion_rel = destination_pair(
                    result.input, used_companions
                )
                attachment = candidate / "sources" / attachment_rel
                companion = candidate / "sources" / companion_rel
                attachment.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(result.input.source, attachment)
                okf.write_text_if_changed(
                    companion,
                    source_concept(result, attachment.name, ingested_at),
                )

            render_all_indexes(root, candidate)
            os.replace(candidate, target)
            moved = True
            okf.save_registry(root, registry)
            okf.sync_master_roadmap(root)
            okf.sync_indexes(root)
            issues = okf.validate(root)
            if issues:
                raise RuntimeError(okf.format_issues(issues))
            return target
        except Exception:
            if moved and target.exists():
                shutil.rmtree(target)
                okf.save_registry(root, original_registry)
                okf.write_text_if_changed(roadmap_path, original_roadmap)
                okf.sync_indexes(root)
            raise
        finally:
            shutil.rmtree(staging, ignore_errors=True)


def intake(
    root: Path,
    supplied: Path,
    title: str,
    converter: Converter,
    force_new: bool = False,
    max_files: int = DEFAULT_MAX_FILES,
    max_file_bytes: int = DEFAULT_MAX_FILE_BYTES,
    max_total_bytes: int = DEFAULT_MAX_TOTAL_BYTES,
) -> Path:
    inputs = collect_inputs(
        root,
        supplied,
        max_files=max_files,
        max_file_bytes=max_file_bytes,
        max_total_bytes=max_total_bytes,
    )
    if not force_new:
        known = existing_hashes(root)
        duplicates = [
            f"{item.relative} already exists in {known[item.sha256]}"
            for item in inputs
            if item.sha256 in known
        ]
        if duplicates:
            raise ValueError("duplicate source content:\n" + "\n".join(duplicates))
    converted = convert_all(inputs, converter)
    return publish_research(root, supplied, title, converted)


def isolated_python() -> Optional[Path]:
    if sys.platform == "win32":
        candidate = TOOLS_DIR / ".venv" / "Scripts" / "python.exe"
    else:
        candidate = TOOLS_DIR / ".venv" / "bin" / "python"
    return candidate if candidate.is_file() else None


def production_converter() -> Converter:
    try:
        return MarkItDownAdapter()
    except ConversionError:
        isolated = isolated_python()
        if isolated and Path(sys.executable).resolve() != isolated.resolve():
            os.execv(str(isolated), [str(isolated), str(Path(__file__).resolve()), *sys.argv[1:]])
        raise


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Create one RS research topic by converting a local file or directory."
    )
    parser.add_argument("path", type=Path, help="local file or directory to ingest")
    parser.add_argument("--title", help="research entry name; prompts when omitted in a terminal")
    parser.add_argument("--force-new", action="store_true", help="allow content already ingested")
    parser.add_argument("--max-files", type=int, default=DEFAULT_MAX_FILES)
    parser.add_argument("--max-file-mb", type=int, default=100)
    parser.add_argument("--max-total-mb", type=int, default=500)
    parser.add_argument("--root", type=Path, default=ROOT, help=argparse.SUPPRESS)
    return parser


def main(argv: Optional[list[str]] = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        title = title_from_user(args.title)
        converter = production_converter()
        target = intake(
            args.root.resolve(),
            args.path,
            title,
            converter,
            force_new=args.force_new,
            max_files=args.max_files,
            max_file_bytes=args.max_file_mb * 1024 * 1024,
            max_total_bytes=args.max_total_mb * 1024 * 1024,
        )
    except (ConversionError, OSError, RuntimeError, ValueError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    print(f"Created {okf.relative(args.root.resolve(), target)}")
    converted_count = sum(
        1
        for path in (target / "sources").glob("**/*.md")
        if path.name != "index.md"
    )
    print(f"Converted files: {converted_count}")
    print("OKF v0.1 conformance: PASS")
    print("Research Scaffold OKF Profile: PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
