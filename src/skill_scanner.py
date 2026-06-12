"""Discover Agent Skills that headless `claude -p` can auto-load, and read each
SKILL.md's frontmatter (name + description) for the LLM node's skill picker.

Only the paths `claude -p` actually reads are scanned, so every listed skill is
one the node can fire: plugin marketplaces, ~/.claude/skills, <cwd>/.claude/skills.
No PyYAML dependency — a tiny line parser handles the name/description we need.
"""
from __future__ import annotations

import re
from pathlib import Path

from src.shared import _log

_KEY = re.compile(r"^([A-Za-z_][\w-]*):(.*)$")
_FOLD = {">", "|", ">-", "|-", ">+", "|+"}


def _parse_frontmatter(text: str) -> dict:
    """Read the leading `---`-fenced YAML block, returning top-level scalar keys.
    Handles folded (`>`) / literal (`|`) multi-line values by joining their
    indented continuation lines with a single space. Quotes are stripped."""
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        return {}
    end = None
    for i in range(1, len(lines)):
        if lines[i].strip() == "---":
            end = i
            break
    if end is None:
        return {}

    data: dict = {}
    key: str | None = None
    buf: list[str] = []
    folded = False

    def flush() -> None:
        if key is not None:
            data[key] = " ".join(b for b in buf if b).strip().strip("\"'")

    for ln in lines[1:end]:
        m = _KEY.match(ln)
        if m and not ln.startswith((" ", "\t")):
            flush()
            key = m.group(1)
            val = m.group(2).strip()
            if val in _FOLD:
                folded, buf = True, []
            else:
                folded, buf = False, [val]
        elif key is not None and (folded or ln.startswith((" ", "\t"))):
            buf.append(ln.strip())
    flush()
    return data
