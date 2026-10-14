#!/usr/bin/env bash
# One-command dev run (macOS / Linux). Picks a supported Python (3.10–3.14) and
# hands over to scripts/dev.py, which does the real work. Windows: py scripts\dev.py
set -euo pipefail
cd "$(dirname "$0")/.."

for candidate in python3.13 python3.12 python3.11 python3.10 python3.14 python3 python; do
  if command -v "$candidate" >/dev/null 2>&1 &&
     "$candidate" -c 'import sys; sys.exit(0 if (3,10) <= sys.version_info[:2] <= (3,14) else 1)' 2>/dev/null; then
    exec "$candidate" scripts/dev.py "$@"
  fi
done

echo "✗ Rakshak AI needs Python 3.10 – 3.14, but none was found on PATH." >&2
echo "  Found: $(python3 --version 2>&1 || echo 'no python3')" >&2
echo "  Install Python 3.12 (python.org or 'brew install python@3.12') and re-run 'make dev'." >&2
exit 1
