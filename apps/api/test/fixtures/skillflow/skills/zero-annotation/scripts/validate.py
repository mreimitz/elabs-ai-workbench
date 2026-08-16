#!/usr/bin/env python3
"""Trivial structural check for the data-report skill fixture.

Exits 0 when the input file is non-empty and has more than one line
(a header plus at least one record); exits 1 otherwise.
"""
import sys


def main(path: str) -> int:
    with open(path, "r", encoding="utf-8") as handle:
        lines = [line for line in handle.read().splitlines() if line.strip()]
    return 0 if len(lines) > 1 else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]) if len(sys.argv) > 1 else 1)
