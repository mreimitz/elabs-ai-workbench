"""Tests for OKF validation, projected-write guards, and generators."""

from __future__ import annotations

import argparse
import contextlib
import hashlib
import io
import importlib.util
import json
import os
import shutil
import sys
import tempfile
import unittest
import unittest.mock
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]

# --- Fixtures pinned to THIS repository's bundle ------------------------------------------------
# The completion tests copy the live bundle to a temp dir and complete an item there, so MVP_ITEM
# must still be under Roadmap/ (never already in Roadmap/completed/). FOLLOW_ON_ITEM links it, which
# proves the move re-points bundle links. NO_LEDGER_TAG names an item that genuinely has no
# STATUS.md, which is the only case the --no-ledger waiver exists for.
MVP_ITEM = "RM-01-advisor"
FOLLOW_ON_ITEM = "RM-03-assistant-hub"
NO_LEDGER_TAG = "RM-19"

MODULE_PATH = ROOT / ".claude" / "scripts" / "okf.py"
SPEC = importlib.util.spec_from_file_location("research_scaffold_okf", MODULE_PATH)
assert SPEC and SPEC.loader
okf = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = okf
SPEC.loader.exec_module(okf)


class OkfValidationTests(unittest.TestCase):
    def test_current_scaffold_passes_both_layers(self) -> None:
        self.assertEqual([], okf.validate(ROOT))

    def test_missing_frontmatter_is_official_conformance_error(self) -> None:
        profile = okf.load_profile(ROOT)
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "bad.md"
            path.write_text("# Missing frontmatter\n", encoding="utf-8")
            issues, _, _ = okf.validate_concept(Path(temp), path, path.read_text(), profile)
        self.assertIn("OKF001", {issue.code for issue in issues})

    def test_invalid_type_status_pair_is_profile_error(self) -> None:
        profile = okf.load_profile(ROOT)
        content = okf.render_frontmatter(
            {
                "type": "Research Note",
                "title": "Test",
                "description": "A test note.",
                "tags": ["test"],
                "timestamp": "2026-07-24T00:00:00Z",
                "status": "active",
            },
            "# Test\n\nBody.\n\n# Citations\n\nNone.",
        )
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "note.md"
            path.write_text(content, encoding="utf-8")
            issues, _, _ = okf.validate_concept(Path(temp), path, content, profile)
        self.assertIn("PROFILE007", {issue.code for issue in issues})

    def test_pre_hook_rejects_nonconformant_write(self) -> None:
        payload = {
            "tool_name": "Write",
            "tool_input": {
                "file_path": str(ROOT / "Research" / "RS-01-test" / "topic.md"),
                "content": "# Invalid",
            },
        }
        self.assertIn("OKF001", {issue.code for issue in okf.hook_pre(ROOT, payload)})

    def test_pre_hook_accepts_conformant_control_write(self) -> None:
        content = okf.render_frontmatter(
            {
                "type": "Agent Instruction",
                "title": "Temporary instruction",
                "description": "A projected valid control document.",
                "tags": ["agent"],
                "timestamp": "2026-07-24T00:00:00Z",
                "status": "active",
            },
            "# Temporary instruction\n\nTest.",
        )
        payload = {
            "tool_name": "Write",
            "tool_input": {
                "file_path": str(ROOT / ".claude" / "temporary.md"),
                "content": content,
            },
        }
        self.assertEqual([], okf.hook_pre(ROOT, payload))

    def test_pre_hook_requires_timestamp_change_with_meaningful_edit(self) -> None:
        original = (ROOT / "project.md").read_text(encoding="utf-8")
        _, body = okf.parse_frontmatter(original)
        # Derived from the live document so the fixture cannot go stale.
        old_string = next(
            line for line in body.splitlines() if len(line.strip()) > 40
        )
        payload = {
            "tool_name": "Edit",
            "tool_input": {
                "file_path": str(ROOT / "project.md"),
                "old_string": old_string,
                "new_string": old_string + " Rewritten.",
            },
        }
        self.assertIn("PROFILE028", {issue.code for issue in okf.hook_pre(ROOT, payload)})
        self.assertEqual(original, (ROOT / "project.md").read_text(encoding="utf-8"))

    def test_pre_hook_rejects_markdown_under_tools(self) -> None:
        payload = {
            "tool_name": "Write",
            "tool_input": {
                "file_path": str(ROOT / "tools" / "README.md"),
                "content": "# Not allowed",
            },
        }
        self.assertIn("PROFILE031", {issue.code for issue in okf.hook_pre(ROOT, payload)})

    def test_source_attachment_requires_typed_linking_companion(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            sources = root / "Research" / "RS-01-test" / "sources"
            sources.mkdir(parents=True)
            (sources / "evidence.pdf").write_bytes(b"%PDF-test")
            issues = okf.validate_source_attachments(root)
            self.assertIn("PROFILE019", {issue.code for issue in issues})

    def concept(self, **overrides: object) -> str:
        metadata = {
            "type": "Roadmap Item",
            "title": "Test",
            "description": "A test concept.",
            "tags": ["test"],
            "timestamp": "2026-07-24T00:00:00Z",
            "status": "active",
        }
        metadata.update(overrides)
        body = overrides.pop("_body", None) or "# Test\n\nBody."
        metadata.pop("_body", None)
        return okf.render_frontmatter(metadata, str(body))

    def codes(self, path: Path, content: str) -> set[str]:
        profile = okf.load_profile(ROOT)
        issues, _, _ = okf.validate_concept(ROOT, path, content, profile)
        return {issue.code for issue in issues}

    def test_done_roadmap_item_outside_completed_is_rejected(self) -> None:
        content = self.concept(status="done")
        path = ROOT / "Roadmap" / "RM-99-example" / "item.md"
        self.assertIn("PROFILE032", self.codes(path, content))

    def test_completed_roadmap_item_must_be_done(self) -> None:
        path = ROOT / "Roadmap" / "completed" / "RM-99-example" / "item.md"
        self.assertIn("PROFILE035", self.codes(path, self.concept(status="active")))
        done = self.codes(path, self.concept(status="done"))
        self.assertNotIn("PROFILE035", done)
        self.assertNotIn("PROFILE032", done)

    def test_lifecycle_checks_ignore_other_concept_types(self) -> None:
        # RM folders also hold decisions, guides and outputs; they must not be
        # dragged into the roadmap-item lifecycle rules.
        path = ROOT / "Roadmap" / "completed" / "RM-99-example" / "decision.md"
        content = self.concept(
            type="Decision",
            status="accepted",
            _body="# Test\n\nBody.\n\n# Citations\n\nNone.",
        )
        codes = self.codes(path, content)
        self.assertNotIn("PROFILE035", codes)
        self.assertNotIn("PROFILE032", codes)

    def test_resolve_link_survives_an_anchor_only_target(self) -> None:
        """An anchor-only link reaches resolve_link as an empty head; it must not raise."""
        for target in ("", "   ", "#section"):
            self.assertIsNone(okf.resolve_link(ROOT, ROOT / "index.md", target))

    def test_placeholder_guard_fires_on_prose_but_not_on_code(self) -> None:
        """PROFILE009 catches an unfilled template, not legitimate content.

        GitHub Actions ${{ }} expressions, mustache prompt templates and JSX props are document
        content. Only a placeholder sitting in prose means a generator template leaked out live.
        """
        path = ROOT / "Roadmap" / "RM-99-example" / "item.md"
        leaked = self.concept(_body="# Test\n\nThe title is {{TITLE}}.")
        self.assertIn("PROFILE009", self.codes(path, leaked))

        inline = self.concept(_body="# Test\n\nThe token is `${{ secrets.MCPFP_TOKEN }}`.")
        self.assertNotIn("PROFILE009", self.codes(path, inline))

        fenced = self.concept(
            _body="# Test\n\n```yaml\nwith:\n  token: ${{ secrets.MCPFP_TOKEN }}\n```\n"
        )
        self.assertNotIn("PROFILE009", self.codes(path, fenced))

        after_fence = self.concept(
            _body="# Test\n\n```\n{{A}}\n```\n\nAnd then {{B}} in prose.\n"
        )
        self.assertIn("PROFILE009", self.codes(path, after_fence))

    def test_documentation_requires_delivered_increments_section(self) -> None:
        path = ROOT / okf.DOCU_ROOT / "DC-99-example" / "doc.md"
        content = self.concept(type="Documentation", status="draft")
        self.assertIn("PROFILE039", self.codes(path, content))

    def test_draft_documentation_may_have_no_increments(self) -> None:
        path = ROOT / okf.DOCU_ROOT / "DC-99-example" / "doc.md"
        body = f"# Test\n\n{okf.DELIVERED_HEADING}\n\n{okf.INCREMENT_PLACEHOLDER}"
        draft = self.codes(path, self.concept(type="Documentation", status="draft", _body=body))
        self.assertNotIn("PROFILE037", draft)
        self.assertNotIn("PROFILE039", draft)
        current = self.codes(
            path, self.concept(type="Documentation", status="current", _body=body)
        )
        self.assertIn("PROFILE037", current)

    def test_docu_path_policy(self) -> None:
        def codes(*parts: str) -> set[str]:
            return {
                issue.code for issue in okf.path_policy_issues(ROOT, ROOT.joinpath(*parts))
            }

        self.assertEqual(set(), codes(okf.DOCU_ROOT, "index.md"))
        self.assertEqual(set(), codes(okf.DOCU_ROOT, "DC-01-connector-sdk", "doc.md"))
        self.assertIn("PROFILE034", codes(okf.DOCU_ROOT, "loose.md"))
        self.assertIn("PROFILE034", codes(okf.DOCU_ROOT, "DC-1-bad", "doc.md"))

    def test_roadmap_completed_paths_are_allowed(self) -> None:
        def codes(*parts: str) -> set[str]:
            return {
                issue.code for issue in okf.path_policy_issues(ROOT, ROOT.joinpath(*parts))
            }

        self.assertEqual(set(), codes("Roadmap", "completed", "index.md"))
        self.assertEqual(set(), codes("Roadmap", "completed", "RM-01-x", "item.md"))
        self.assertIn("PROFILE027", codes("Roadmap", "completed", "loose.md"))
        self.assertIn("PROFILE027", codes("Roadmap", "completed", "RM-1-x", "item.md"))

    def test_delivery_documentation_requires_cross_links(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            item = root / "Roadmap" / "completed" / "RM-01-example"
            item.mkdir(parents=True)
            (item / "item.md").write_text(
                self.concept(status="done"), encoding="utf-8"
            )
            doc_dir = root / okf.DOCU_ROOT / "DC-01-subject"
            doc_dir.mkdir(parents=True)
            doc = doc_dir / "doc.md"

            def write(body: str) -> None:
                doc.write_text(
                    self.concept(type="Documentation", status="draft", _body=body),
                    encoding="utf-8",
                )

            write(f"# Subject\n\n{okf.DELIVERED_HEADING}\n\n{okf.INCREMENT_PLACEHOLDER}")
            self.assertIn(
                "PROFILE036",
                {issue.code for issue in okf.validate_delivery_documentation(root)},
            )

            write(f"# Subject\n\n{okf.DELIVERED_HEADING}\n\n### RM-01 — Example\n\nNo link.")
            codes = {issue.code for issue in okf.validate_delivery_documentation(root)}
            self.assertIn("PROFILE038", codes)
            self.assertIn("PROFILE036", codes)

            write(
                f"# Subject\n\n{okf.DELIVERED_HEADING}\n\n### RM-01 — Example\n\n"
                "Roadmap item: [RM-01](/Roadmap/completed/RM-01-example/item.md)."
            )
            self.assertEqual([], okf.validate_delivery_documentation(root))

    def test_tag_dir_re_accepts_dc(self) -> None:
        self.assertTrue(okf.TAG_DIR_RE.fullmatch("DC-01-connector-sdk"))
        self.assertFalse(okf.TAG_DIR_RE.fullmatch("DX-01-nope"))
        self.assertEqual("DC-01", okf.item_tag("DC-01-connector-sdk"))

    def test_registry_migrates_missing_dc_keys(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / ".claude").mkdir()
            (root / ".claude" / "tag-registry.json").write_text(
                json.dumps({"next_rs": 3, "next_rm": 2, "allocated_rs": [], "allocated_rm": []}),
                encoding="utf-8",
            )
            registry = okf.load_registry(root)
        self.assertEqual(1, registry["next_dc"])
        self.assertEqual([], registry["allocated_dc"])
        self.assertEqual(3, registry["next_rs"])

    def test_hook_blocks_in_place_done_flip(self) -> None:
        """An agent must not be able to hand-complete a roadmap item."""
        item = ROOT / "Roadmap" / MVP_ITEM / "item.md"
        original = item.read_text(encoding="utf-8")
        metadata, body = okf.parse_frontmatter(original)
        assert metadata is not None
        metadata["status"] = "done"
        metadata["timestamp"] = "2030-01-01T00:00:00Z"
        payload = {
            "tool_name": "Write",
            "tool_input": {
                "file_path": str(item),
                "content": okf.render_frontmatter(metadata, body),
            },
        }
        self.assertIn("PROFILE032", {issue.code for issue in okf.hook_pre(ROOT, payload)})
        self.assertEqual(original, item.read_text(encoding="utf-8"))

    def test_hook_rejects_markdown_directly_under_docu(self) -> None:
        payload = {
            "tool_name": "Write",
            "tool_input": {"file_path": str(ROOT / okf.DOCU_ROOT / "notes.md"), "content": "# No"},
        }
        self.assertIn("PROFILE034", {issue.code for issue in okf.hook_pre(ROOT, payload)})

    def test_tag_uniqueness_spans_roadmap_roots(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "Roadmap" / "RM-01-active").mkdir(parents=True)
            (root / "Roadmap" / "completed" / "RM-01-shipped").mkdir(parents=True)
            issues = okf.validate_tag_uniqueness(root)
        self.assertIn("PROFILE023", {issue.code for issue in issues})

    def test_increment_insertion_keeps_ascending_order(self) -> None:
        body = f"# Subject\n\n{okf.DELIVERED_HEADING}\n\n{okf.INCREMENT_PLACEHOLDER}\n"
        body = okf.insert_increment(body, "RM-03", "### RM-03 — Third\n\nThird.")
        body = okf.insert_increment(body, "RM-01", "### RM-01 — First\n\nFirst.")
        self.assertNotIn(okf.INCREMENT_PLACEHOLDER, body)
        self.assertEqual(["RM-01", "RM-03"], list(okf.delivered_increments(body)))
        with self.assertRaises(ValueError):
            okf.insert_increment(body, "RM-01", "### RM-01 — Again\n\nAgain.")

    def test_log_append_preserves_newest_first(self) -> None:
        text = "# Log\n\n## 2026-01-02\n\n* Older entry.\n"
        updated = okf.append_log_entry(text, "* New entry.")
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "log.md"
            path.write_text(updated, encoding="utf-8")
            self.assertEqual([], okf.validate_log(Path(temp), path, updated))
        self.assertIn("* New entry.", updated)


class GeneratorIntegrationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name) / "scaffold"
        shutil.copytree(
            ROOT,
            self.root,
            ignore=shutil.ignore_patterns("__pycache__", "*.pyc", ".git", ".venv"),
        )

    def tearDown(self) -> None:
        self.temp.cleanup()

    def registry(self) -> dict:
        return okf.load_registry(self.root)

    def test_research_and_roadmap_generation_remain_conformant(self) -> None:
        before = self.registry()
        expected_rs = f"RS-{before['next_rs']:02d}"
        expected_rm = f"RM-{before['next_rm']:02d}"
        research_args = argparse.Namespace(
            title="OKF Compliance",
            objective="Verify the generated research structure.",
            why_now="The template must remain conformant.",
            scope_in="Generated RS structure and metadata.",
            scope_out="External publication.",
            deliverable="A validated research output.",
            success_criteria="Both validation layers pass.",
            slug=None,
        )
        research_path = okf.new_research(self.root, research_args)
        self.assertEqual(f"{expected_rs}-okf-compliance", research_path.name)

        roadmap_args = argparse.Namespace(
            title="Ship OKF Template",
            goal="Deliver the conformant scaffold.",
            why_it_matters="Every generated project needs valid knowledge structure.",
            milestone=["Validate the implementation."],
            research=["RS-01"],
            slug=None,
        )
        roadmap_path = okf.new_roadmap(self.root, roadmap_args)
        self.assertEqual(f"{expected_rm}-ship-okf-template", roadmap_path.name)

        self.assertEqual([], okf.validate(self.root))
        after = self.registry()
        self.assertEqual(before["allocated_rs"] + [expected_rs], after["allocated_rs"])
        self.assertEqual(before["allocated_rm"] + [expected_rm], after["allocated_rm"])

    def ensure_domains(self) -> None:
        """Create the newer domain roots the way the one-time bootstrap does."""
        (self.root / okf.DOCU_ROOT).mkdir(exist_ok=True)
        (self.root / "Roadmap" / "completed").mkdir(exist_ok=True)
        okf.sync_indexes(self.root)
        self.assertEqual([], okf.validate(self.root))

    def snapshot(self) -> dict[str, str]:
        digests: dict[str, str] = {}
        for current, dirs, files in os.walk(self.root):
            dirs[:] = [
                name
                for name in dirs
                if name not in {"__pycache__", ".git"} and not name.startswith(".okf-staging-")
            ]
            for name in files:
                path = Path(current) / name
                if name == ".tag-allocation.lock":
                    continue
                digests[str(path.relative_to(self.root))] = hashlib.sha256(
                    path.read_bytes()
                ).hexdigest()
        return digests

    def make_docu(self, title: str = "Fixture Subject") -> str:
        target = okf.new_docu(
            self.root,
            argparse.Namespace(
                title=title,
                subject="A test-fixture subject standing in for a part of the system.",
                scope_in="Whatever the fixture completion records into it.",
                scope_out="Everything else.",
                code_location=["packages/shared/"],
                slug=None,
            ),
        )
        return okf.item_tag(target.name) or target.name

    def write_ledger(self, open_boxes: int = 0, item: str = MVP_ITEM) -> Path:
        """Write the item's STATUS.md ledger, optionally leaving boxes open."""
        boxes = ["- [x] WP 1.1 — the shipped one — done 2026-08-20"]
        boxes += [f"- [ ] WP 1.{n + 2} — still open" for n in range(open_boxes)]
        ledger = self.root / "Roadmap" / item / "STATUS.md"
        ledger.write_text(
            okf.render_frontmatter(
                {
                    "type": "Status Ledger",
                    "title": "Work-package status ledger",
                    "description": "Living work-package state for this item.",
                    "tags": ["roadmap", "ledger"],
                    "timestamp": "2026-08-20T00:00:00Z",
                    "status": "active",
                },
                "\n".join(["# Work-package status ledger", "", "## Phase 1", *boxes]),
            ),
            encoding="utf-8",
        )
        okf.sync_indexes(self.root)
        return ledger

    def completion_args(self, **overrides: object) -> argparse.Namespace:
        defaults = dict(
            tag="RM-01",
            docu=["DC-01"],
            shipped="The fixture delivery this completion records.",
            deviation=[],
            gap=[],
            code_path=["packages/"],
            summary=None,
            ledger=[],
            no_ledger=False,
            keep_milestones=False,
            docu_status="current",
            require_clean_tree=False,
            scan_root=None,
            no_scan=True,
            strict_references=False,
        )
        defaults.update(overrides)
        return argparse.Namespace(**defaults)

    def test_new_docu_generates_conformant_documentation(self) -> None:
        self.ensure_domains()
        before = self.registry()
        tag = self.make_docu()
        self.assertEqual(f"DC-{before['next_dc']:02d}", tag)
        self.assertEqual([], okf.validate(self.root))
        self.assertEqual(before["allocated_dc"] + [tag], self.registry()["allocated_dc"])

    def test_complete_roadmap_moves_item_and_records_increment(self) -> None:
        self.ensure_domains()
        docu_tag = self.make_docu()
        self.write_ledger()
        result = okf.complete_roadmap(self.root, self.completion_args(docu=[docu_tag]))

        source = self.root / "Roadmap" / MVP_ITEM
        destination = self.root / "Roadmap" / "completed" / MVP_ITEM
        self.assertFalse(source.exists())
        self.assertTrue(destination.is_dir())
        self.assertEqual(destination, result.destination)

        item = okf.concept_metadata(destination / "item.md")
        self.assertEqual("done", item["status"])
        self.assertNotIn("- [ ] ", (destination / "item.md").read_text(encoding="utf-8"))
        self.assertGreater(result.milestones_ticked, 0)

        doc_path = next((self.root / okf.DOCU_ROOT).glob(f"{docu_tag}-*/doc.md"))
        doc_body = doc_path.read_text(encoding="utf-8")
        self.assertIn("### RM-01", doc_body)
        self.assertIn(f"/Roadmap/completed/{MVP_ITEM}/item.md", doc_body)
        self.assertEqual("current", okf.concept_metadata(doc_path)["status"])

        roadmap = (self.root / "Roadmap" / "roadmap.md").read_text(encoding="utf-8")
        self.assertIn(f"completed/{MVP_ITEM}/item.md", roadmap)
        self.assertIn(
            MVP_ITEM,
            (self.root / "Roadmap" / "completed" / "index.md").read_text(encoding="utf-8"),
        )
        self.assertEqual([], okf.validate(self.root))

    def test_complete_roadmap_repoints_bundle_links_to_the_new_path(self) -> None:
        """A later roadmap item links the MVP; the move must not break it."""
        self.ensure_domains()
        docu_tag = self.make_docu()
        self.write_ledger()
        follow_on = self.root / "Roadmap" / FOLLOW_ON_ITEM / "item.md"
        before = okf.concept_metadata(follow_on)["timestamp"]
        self.assertIn(f"/Roadmap/{MVP_ITEM}/", follow_on.read_text())

        result = okf.complete_roadmap(self.root, self.completion_args(docu=[docu_tag]))

        text = follow_on.read_text(encoding="utf-8")
        self.assertIn(f"/Roadmap/completed/{MVP_ITEM}", text)
        self.assertNotIn(f"](/Roadmap/{MVP_ITEM}", text)
        self.assertNotEqual(before, okf.concept_metadata(follow_on)["timestamp"])
        self.assertIn(f"Roadmap/{FOLLOW_ON_ITEM}/item.md", result.repointed)
        self.assertEqual([], okf.validate(self.root))

    def test_complete_roadmap_refuses_while_work_packages_are_open(self) -> None:
        self.ensure_domains()
        docu_tag = self.make_docu()
        self.write_ledger(open_boxes=2)
        before = self.snapshot()
        with self.assertRaisesRegex(RuntimeError, "work-package ledger is not finished"):
            okf.complete_roadmap(self.root, self.completion_args(docu=[docu_tag]))
        self.assertEqual(before, self.snapshot())

    def test_complete_roadmap_requires_a_ledger_or_an_explicit_waiver(self) -> None:
        self.ensure_domains()
        docu_tag = self.make_docu()
        with self.assertRaisesRegex(
            RuntimeError, f"no STATUS.md ledger was found for {NO_LEDGER_TAG}"
        ):
            okf.complete_roadmap(
                self.root, self.completion_args(tag=NO_LEDGER_TAG, docu=[docu_tag])
            )

    def test_complete_roadmap_rolls_back_on_late_failure(self) -> None:
        self.ensure_domains()
        docu_tag = self.make_docu()
        self.write_ledger()
        for target, patch in (
            ("sync_master_roadmap", RuntimeError("boom")),
            ("validate", None),
        ):
            with self.subTest(failure=target):
                before = self.snapshot()
                if patch is None:
                    fake = [okf.Issue("profile", "PROFILE999", "x", "injected")]
                    context = unittest.mock.patch.object(okf, target, return_value=fake)
                else:
                    context = unittest.mock.patch.object(okf, target, side_effect=patch)
                with context:
                    with self.assertRaises(RuntimeError):
                        okf.complete_roadmap(
                            self.root, self.completion_args(docu=[docu_tag])
                        )
                self.assertEqual(before, self.snapshot())

    def test_complete_roadmap_is_idempotent_guarded(self) -> None:
        self.ensure_domains()
        docu_tag = self.make_docu()
        self.write_ledger()
        okf.complete_roadmap(self.root, self.completion_args(docu=[docu_tag]))
        after = self.snapshot()
        with self.assertRaisesRegex(RuntimeError, "already completed"):
            okf.complete_roadmap(self.root, self.completion_args(docu=[docu_tag]))
        self.assertEqual(after, self.snapshot())

    def test_check_references_is_inert_for_an_item_that_has_not_moved(self) -> None:
        buffer = io.StringIO()
        with contextlib.redirect_stdout(buffer):
            code = okf.check_references(
                self.root, argparse.Namespace(tag="RM-01", scan_root=None)
            )
        self.assertEqual(0, code)
        self.assertIn("has not been completed", buffer.getvalue())

    def test_check_references_reports_after_a_completion(self) -> None:
        self.ensure_domains()
        docu_tag = self.make_docu()
        self.write_ledger()
        okf.complete_roadmap(self.root, self.completion_args(docu=[docu_tag]))
        # A repository document outside the bundle still names the old path. The tool must
        # REPORT it and must not edit it — everything outside --root is the operator's.
        with tempfile.TemporaryDirectory() as scan_root:
            guide = Path(scan_root) / "guide.md"
            original = f"The plan lives in planning/Roadmap/{MVP_ITEM}/item.md.\n"
            guide.write_text(original, encoding="utf-8")
            buffer = io.StringIO()
            with contextlib.redirect_stderr(buffer):
                code = okf.check_references(
                    self.root, argparse.Namespace(tag="RM-01", scan_root=scan_root)
                )
            self.assertEqual(3, code)
            self.assertIn("guide.md", buffer.getvalue())
            self.assertEqual(original, guide.read_text(encoding="utf-8"))

    def test_stale_reference_report_finds_outside_root_paths(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            repo = Path(temp)
            bundle = repo / "planning"
            (bundle / "Roadmap" / "completed" / "RM-01-x").mkdir(parents=True)
            (repo / "README.md").write_text(
                "See planning/Roadmap/RM-01-x/plan.md for the plan.\n"
                "Already moved: planning/Roadmap/completed/RM-01-x/plan.md\n",
                encoding="utf-8",
            )
            before = {
                path: path.read_bytes() for path in repo.rglob("*") if path.is_file()
            }
            stale = okf.stale_reference_report(
                bundle, "Roadmap/RM-01-x", "Roadmap/completed/RM-01-x", repo
            )
            after = {path: path.read_bytes() for path in repo.rglob("*") if path.is_file()}
        self.assertEqual(before, after)
        self.assertEqual(1, len(stale))
        self.assertIn("planning/Roadmap/completed/RM-01-x/plan.md", stale[0].suggestion)


if __name__ == "__main__":
    unittest.main()
