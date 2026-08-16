#!/usr/bin/env python3
"""Structural check for an analyzer input. Exits 0 when the input is well-formed, non-zero otherwise."""
import sys


def main() -> int:
    # A real check would validate columns/types; the fixture only needs a documented exit contract.
    if len(sys.argv) < 2:
        print("usage: check.py <input>", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
