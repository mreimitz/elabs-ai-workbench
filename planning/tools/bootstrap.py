#!/usr/bin/env python3
"""Create the isolated Python 3.10+ environment used by scaffold tools."""

from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path


TOOLS_DIR = Path(__file__).resolve().parent
VENV_DIR = TOOLS_DIR / ".venv"


def compatible_python() -> str:
    if sys.version_info >= (3, 10):
        return sys.executable
    for candidate in ("python3.13", "python3.12", "python3.11", "python3.10"):
        resolved = shutil.which(candidate)
        if resolved:
            return resolved
    raise RuntimeError(
        "doc-intake requires Python 3.10 or newer; install one before bootstrapping"
    )


def venv_python() -> Path:
    if sys.platform == "win32":
        return VENV_DIR / "Scripts" / "python.exe"
    return VENV_DIR / "bin" / "python"


def main() -> int:
    try:
        python = compatible_python()
        if not venv_python().is_file():
            subprocess.run([python, "-m", "venv", str(VENV_DIR)], check=True)
        subprocess.run(
            [
                str(venv_python()),
                "-m",
                "pip",
                "install",
                "--requirement",
                str(TOOLS_DIR / "requirements.txt"),
            ],
            check=True,
        )
    except (RuntimeError, subprocess.CalledProcessError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    print(f"Tool environment is ready: {VENV_DIR}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
