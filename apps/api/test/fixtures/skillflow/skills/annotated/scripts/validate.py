#!/usr/bin/env python3
"""Same trivial check as the zero-annotation fixture, duplicated here so the
annotated skill is self-contained."""
import sys


def main(path: str) -> int:
    with open(path, "r", encoding="utf-8") as handle:
        lines = [line for line in handle.read().splitlines() if line.strip()]
    return 0 if len(lines) > 1 else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]) if len(sys.argv) > 1 else 1)
