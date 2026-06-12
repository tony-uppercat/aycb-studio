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
