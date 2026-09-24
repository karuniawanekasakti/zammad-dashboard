#!/usr/bin/env python
"""Run backend tests without adding a test-framework dependency."""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

TESTS = Path(__file__).parent


def run_files(files: list[Path]) -> int:
    for path in files:
        print(f"\n==> {path.relative_to(TESTS)}", flush=True)
        result = subprocess.run(
            [sys.executable, "-c", "import runpy, sys; runpy.run_path(sys.argv[1], run_name='__main__')", str(path.resolve())],
            cwd=TESTS.parent,
        )
        if result.returncode:
            return result.returncode
    return 0


def run(suite: str) -> int:
    return run_files(sorted((TESTS / suite).glob("test_*.py")))

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "target",
        nargs="?",
        default="unit",
        help="unit (default), integration, all, or a test path relative to tests/",
    )
    target = parser.parse_args().target
    if target in ("unit", "integration", "all"):
        suites = ("unit", "integration") if target == "all" else (target,)
        for name in suites:
            result = run(name)
            if result:
                return result
        return 0

    path = (TESTS / target).resolve()
    if path.parent not in (TESTS.resolve(), (TESTS / "unit").resolve(), (TESTS / "integration").resolve()) or not path.is_file():
        parser.error(f"unknown test: {target}")
    return run_files([path])


if __name__ == "__main__":
    raise SystemExit(main())
