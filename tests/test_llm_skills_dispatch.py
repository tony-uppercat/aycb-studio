from unittest.mock import patch

from fastapi.testclient import TestClient

from src.api import app


def test_chat_forwards_skills_to_claude_cli():
    client = TestClient(app)
    captured = {}

    def fake_run(prompt, model_id, system_file, image_paths,
                 run_fn=None, skills_enabled=False, skill_names=None, effort=None):
        captured["skills_enabled"] = skills_enabled
        captured["skill_names"] = skill_names
        captured["effort"] = effort
        return {"text": "ok", "status": "OK",
                "usage": {"input_tokens": 1, "output_tokens": 1, "cost_usd": 0.0}}

    with patch("src.routers.llm.claude_cli.run", side_effect=fake_run):
        r = client.post("/api/llm/chat", data={
            "prompt": "hi", "model": "cli-claude-opus-4-8",
            "skills_mode": "true", "skills": "caveman, react-patterns",
        })
    assert r.status_code == 200
    assert captured["skills_enabled"] is True
    assert captured["skill_names"] == ["caveman", "react-patterns"]
