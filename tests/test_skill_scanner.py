from pathlib import Path

from src import skill_scanner


def _write_skill(root: Path, folder: str, body: str) -> None:
    d = root / folder
    d.mkdir(parents=True, exist_ok=True)
    (d / "SKILL.md").write_text(body, encoding="utf-8")


def test_parse_frontmatter_inline():
    text = "---\nname: caveman\ndescription: Talk short.\n---\nBody here.\n"
    fm = skill_scanner._parse_frontmatter(text)
    assert fm["name"] == "caveman"
    assert fm["description"] == "Talk short."


def test_parse_frontmatter_folded_description():
    text = (
        "---\n"
        "name: react-patterns\n"
        "description: >\n"
        "  Comprehensive React 19 patterns covering\n"
        "  Server Components and Actions.\n"
        "---\n"
        "Body.\n"
    )
    fm = skill_scanner._parse_frontmatter(text)
    assert fm["name"] == "react-patterns"
    assert fm["description"] == "Comprehensive React 19 patterns covering Server Components and Actions."


def test_parse_frontmatter_no_fence_returns_empty():
    assert skill_scanner._parse_frontmatter("no frontmatter here") == {}


def test_scan_skills_lists_name_and_description(tmp_path):
    base = tmp_path / "skills"
    _write_skill(base, "caveman", "---\nname: caveman\ndescription: Talk short.\n---\n")
    _write_skill(base, "react", "---\nname: react-patterns\ndescription: React 19.\n---\n")
    out = skill_scanner.scan_skills([base])
    names = {s["name"] for s in out}
    assert names == {"caveman", "react-patterns"}
    cave = next(s for s in out if s["name"] == "caveman")
    assert cave["description"] == "Talk short."
    assert "source" in cave


def test_scan_skills_dedups_by_name(tmp_path):
    b1, b2 = tmp_path / "a", tmp_path / "b"
    _write_skill(b1, "caveman", "---\nname: caveman\ndescription: First.\n---\n")
    _write_skill(b2, "caveman2", "---\nname: caveman\ndescription: Second.\n---\n")
    out = skill_scanner.scan_skills([b1, b2])
    assert [s["name"] for s in out] == ["caveman"]
    assert out[0]["description"] == "First."  # first occurrence wins


def test_scan_skills_skips_missing_name(tmp_path):
    base = tmp_path / "skills"
    _write_skill(base, "bad", "---\ndescription: no name.\n---\n")
    assert skill_scanner.scan_skills([base]) == []


def test_scan_skills_ignores_nonexistent_path(tmp_path):
    assert skill_scanner.scan_skills([tmp_path / "nope"]) == []


def test_default_skill_paths_includes_user_and_cwd():
    paths = skill_scanner.default_skill_paths()
    strs = [str(p) for p in paths]
    assert any(p.endswith(".claude/skills") or p.endswith(".claude\\skills") for p in strs)
