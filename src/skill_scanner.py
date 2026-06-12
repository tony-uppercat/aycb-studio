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


def scan_skills(base_paths: list[Path]) -> list[dict]:
    """Return [{name, description, source}] for every SKILL.md under each base
    (`<base>/*/SKILL.md`). Dedups by name (first wins). A base that does not
    exist is skipped; an unreadable/malformed SKILL.md is logged and skipped —
    never raised (rule 12)."""
    seen: set[str] = set()
    out: list[dict] = []
    for base in base_paths:
        if not base.exists():
            continue
        for skill_md in sorted(base.glob("*/SKILL.md")):
            try:
                text = skill_md.read_text(encoding="utf-8")
            except OSError as exc:
                _log(f"skill_scanner: cannot read {skill_md}: {exc}")
                continue
            fm = _parse_frontmatter(text)
            name = (fm.get("name") or "").strip()
            if not name or name in seen:
                continue
            seen.add(name)
            out.append({
                "name": name,
                "description": (fm.get("description") or "").strip(),
                "source": base.parent.name or str(base),
            })
    return out


def default_skill_paths() -> list[Path]:
    """The skill roots headless `claude -p` actually discovers: every plugin
    marketplace's `skills/` dir, the user skills dir, and the cwd project skills
    dir. cwd = backend process cwd = repo root."""
    home = Path.home()
    paths: list[Path] = []
    marketplaces = home / ".claude" / "plugins" / "marketplaces"
    if marketplaces.exists():
        paths.extend(sorted(marketplaces.glob("*/skills")))
    paths.append(home / ".claude" / "skills")
    paths.append(Path.cwd() / ".claude" / "skills")
    return paths
