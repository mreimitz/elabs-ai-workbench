"""End-to-end tests for file and directory document intake."""

from __future__ import annotations

import importlib.util
import shutil
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
MODULE_PATH = ROOT / "tools" / "doc_intake.py"
SPEC = importlib.util.spec_from_file_location("scaffold_doc_intake", MODULE_PATH)
assert SPEC and SPEC.loader
sys.path.insert(0, str(ROOT / "tools"))
doc_intake = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = doc_intake
SPEC.loader.exec_module(doc_intake)


class FakeConverter:
    def convert_local(self, path: Path):
        return doc_intake.ConversionResult(
            markdown=f"# Extracted {path.name}\n\nContent from {path.name}.",
            converter="test/fake",
            converter_version="1.0",
        )


class FailingConverter:
    def convert_local(self, path: Path):
        raise doc_intake.ConversionError(f"cannot convert {path.name}")


class DocIntakeTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        temp_root = Path(self.temp.name)
        self.root = temp_root / "scaffold"
        shutil.copytree(
            ROOT,
            self.root,
            ignore=shutil.ignore_patterns("__pycache__", "*.pyc", ".git", ".venv"),
        )
        self.inputs = temp_root / "inputs"
        self.inputs.mkdir()

    def tearDown(self) -> None:
        self.temp.cleanup()

    def rs_dirs(self) -> set[str]:
        """Topic folders present now; the fixture copies the live bundle's own."""
        return {p.name for p in (self.root / "Research").glob("RS-*") if p.is_dir()}

    def test_single_file_creates_one_valid_rs_topic(self) -> None:
        source = self.inputs / "Market Report.pdf"
        source.write_bytes(b"%PDF-test-content")
        target = doc_intake.intake(
            self.root, source, "Market Evidence", FakeConverter()
        )
        self.assertRegex(target.name, r"^RS-\d{2}-market-evidence$")
        self.assertTrue((target / "sources" / "market-report.pdf").is_file())
        concept = target / "sources" / "market-report.md"
        self.assertTrue(concept.is_file())
        metadata, body = doc_intake.okf.parse_frontmatter(concept.read_text())
        self.assertEqual("Source Reference", metadata["type"])
        self.assertIn("## Extracted content", body)
        self.assertEqual([], doc_intake.okf.validate(self.root))

    def test_directory_is_recursive_and_creates_one_topic(self) -> None:
        (self.inputs / "data.csv").write_text("a,b\n1,2\n", encoding="utf-8")
        nested = self.inputs / "Quarter One"
        nested.mkdir()
        (nested / "Brief.docx").write_bytes(b"docx-test")
        (nested / ".ignored.txt").write_text("hidden", encoding="utf-8")

        target = doc_intake.intake(
            self.root, self.inputs, "Quarterly Source Pack", FakeConverter()
        )
        sources = target / "sources"
        self.assertTrue((sources / "data.csv").is_file())
        self.assertTrue((sources / "data.md").is_file())
        self.assertTrue((sources / "quarter-one" / "brief.docx").is_file())
        self.assertTrue((sources / "quarter-one" / "brief.md").is_file())
        self.assertTrue((sources / "quarter-one" / "index.md").is_file())
        self.assertFalse((sources / "quarter-one" / "ignored.txt").exists())
        self.assertEqual([], doc_intake.okf.validate(self.root))

    def test_duplicate_content_is_rejected_without_consuming_tag(self) -> None:
        first = self.inputs / "first.txt"
        first.write_text("same", encoding="utf-8")
        doc_intake.intake(self.root, first, "First Intake", FakeConverter())
        second = self.inputs / "second.txt"
        second.write_text("same", encoding="utf-8")
        before = self.rs_dirs()

        with self.assertRaisesRegex(ValueError, "duplicate source content"):
            doc_intake.intake(self.root, second, "Second Intake", FakeConverter())
        self.assertEqual(before, self.rs_dirs())

    def test_markdown_input_is_preserved_without_becoming_an_unwrapped_concept(self) -> None:
        source = self.inputs / "README.md"
        source.write_text("# Original markdown\n", encoding="utf-8")
        target = doc_intake.intake(
            self.root, source, "Markdown Evidence", FakeConverter()
        )
        self.assertTrue((target / "sources" / "readme-source.source").is_file())
        self.assertTrue((target / "sources" / "readme-source.md").is_file())
        self.assertEqual([], doc_intake.okf.validate(self.root))

    def test_unsafe_archive_is_rejected_before_conversion(self) -> None:
        before = self.rs_dirs()
        archive = self.inputs / "unsafe.zip"
        with zipfile.ZipFile(archive, "w") as handle:
            handle.writestr("../escape.txt", "unsafe")
        with self.assertRaisesRegex(ValueError, "unsafe archive path"):
            doc_intake.collect_inputs(self.root, archive)
        self.assertEqual(before, self.rs_dirs())

    def test_conversion_failure_is_atomic(self) -> None:
        before = self.rs_dirs()
        good = self.inputs / "good.txt"
        bad = self.inputs / "bad.bin"
        good.write_text("good", encoding="utf-8")
        bad.write_bytes(b"bad")
        with self.assertRaises(doc_intake.ConversionError):
            doc_intake.intake(
                self.root, self.inputs, "Failed Intake", FailingConverter()
            )
        self.assertEqual(before, self.rs_dirs())
        self.assertEqual([], doc_intake.okf.validate(self.root))

    def test_noninteractive_title_is_required(self) -> None:
        with self.assertRaisesRegex(ValueError, "--title"):
            doc_intake.title_from_user(None)


if __name__ == "__main__":
    unittest.main()
