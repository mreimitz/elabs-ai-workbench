"""Narrow local-file adapter for Microsoft MarkItDown."""

from __future__ import annotations

from dataclasses import dataclass
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path
import shutil
import warnings


class ConversionError(RuntimeError):
    """Raised when a local document cannot be converted safely."""


@dataclass(frozen=True)
class ConversionResult:
    markdown: str
    converter: str
    converter_version: str


class MarkItDownAdapter:
    """Convert local files with plugins, remote URIs, and cloud options disabled."""

    EXPECTED_VERSION = "0.1.6"
    AUDIO_SUFFIXES = {".aif", ".aiff", ".flac", ".m4a", ".mp3", ".ogg", ".wav"}

    def __init__(self) -> None:
        try:
            with warnings.catch_warnings():
                warnings.filterwarnings(
                    "ignore",
                    message="Couldn't find ffmpeg or avconv.*",
                    category=RuntimeWarning,
                )
                from markitdown import MarkItDown
        except ImportError as exc:
            raise ConversionError(
                "MarkItDown is not installed. Run: python3 tools/bootstrap.py"
            ) from exc

        self._converter = MarkItDown(enable_plugins=False)
        try:
            self._version = version("markitdown")
        except PackageNotFoundError:
            self._version = "unknown"
        if self._version != self.EXPECTED_VERSION:
            raise ConversionError(
                f"expected MarkItDown {self.EXPECTED_VERSION}, found {self._version}; "
                "run: python3 tools/bootstrap.py"
            )

    def convert_local(self, path: Path) -> ConversionResult:
        if not path.is_file() or path.is_symlink():
            raise ConversionError(f"input is not a safe regular file: {path}")
        if (
            path.suffix.lower() in self.AUDIO_SUFFIXES
            and shutil.which("ffmpeg") is None
            and shutil.which("avconv") is None
        ):
            raise ConversionError(
                f"{path.name} requires ffmpeg or avconv for audio transcription"
            )
        method = getattr(self._converter, "convert_local", None)
        if method is None:
            raise ConversionError("installed MarkItDown lacks the required convert_local API")
        try:
            result = method(str(path))
        except Exception as exc:
            raise ConversionError(f"MarkItDown could not convert {path.name}: {exc}") from exc

        markdown = getattr(result, "markdown", None)
        if not isinstance(markdown, str):
            markdown = getattr(result, "text_content", None)
        if not isinstance(markdown, str) or not markdown.strip():
            raise ConversionError(
                f"{path.name} produced no text; it may require OCR or an optional dependency"
            )
        return ConversionResult(
            markdown=markdown.strip(),
            converter="microsoft/markitdown",
            converter_version=self._version,
        )
