import json

from src import claude_cli


def _ok_payload(result="OK", cost=0.02, inp=3, out=4):
    return json.dumps({
        "type": "result", "subtype": "success", "is_error": False,
        "result": result, "total_cost_usd": cost,
        "usage": {"input_tokens": inp, "output_tokens": out},
    })


def test_is_claude_cli_model():
    assert claude_cli.is_claude_cli_model("cli-claude-opus-4-8")
    assert not claude_cli.is_claude_cli_model("claude-opus-4-6-20250620")
    assert not claude_cli.is_claude_cli_model("gemini-3-flash-preview")


def test_real_model_strips_prefix():
    assert claude_cli.real_model("cli-claude-opus-4-8") == "claude-opus-4-8"
    assert claude_cli.real_model("claude-opus-4-6") == "claude-opus-4-6"


def test_build_command_basics():
    cmd = claude_cli.build_command("claude-opus-4-8", None, 0)
    assert cmd[:2] == ["claude", "-p"]
    assert "--output-format" in cmd and "json" in cmd
    assert cmd[cmd.index("--model") + 1] == "claude-opus-4-8"
    assert cmd[cmd.index("--permission-mode") + 1] == "bypassPermissions"
    assert "--bare" not in cmd
    assert cmd[cmd.index("--max-turns") + 1] == "2"


def test_build_command_effort_appended_when_valid():
    for level in ("low", "medium", "high", "xhigh", "max"):
        cmd = claude_cli.build_command("claude-opus-4-8", None, 0, effort=level)
        assert "--effort" in cmd
        assert cmd[cmd.index("--effort") + 1] == level


def test_build_command_effort_omitted_for_auto_or_invalid():
    # None, 'auto', and unknown values all omit the flag (CLI uses its own default).
    for v in (None, "auto", "extreme", ""):
        cmd = claude_cli.build_command("claude-opus-4-8", None, 0, effort=v)
        assert "--effort" not in cmd


def test_build_command_no_images_disables_all_tools():
    # A generation node is not an agent: with no images the model gets NO tools,
    # so it cannot wander into tool calls (and blow --max-turns) or auto-fire skills.
    cmd = claude_cli.build_command("claude-opus-4-8", None, 0)
    assert cmd[cmd.index("--tools") + 1] == ""


def test_build_command_with_images_allows_only_read():
    # Images are loaded via the Read tool; nothing else is exposed.
    cmd = claude_cli.build_command("claude-opus-4-8", None, 2)
    assert cmd[cmd.index("--tools") + 1] == "Read"


def test_build_command_system_via_file():
    # The system prompt is passed as a FILE path, never inline — a large system prompt as
    # an argv string blows Windows' ~8191-char command-line limit ("command line too long").
    cmd = claude_cli.build_command("claude-opus-4-8", "/tmp/sys.txt", 0)
    assert cmd[cmd.index("--append-system-prompt-file") + 1] == "/tmp/sys.txt"
    assert "--append-system-prompt" not in cmd  # never the inline string variant


def test_build_command_no_system_omits_flag():
    cmd = claude_cli.build_command("claude-opus-4-8", None, 0)
    assert "--append-system-prompt-file" not in cmd
    assert "--append-system-prompt" not in cmd


def test_max_turns_scales_with_images():
    cmd = claude_cli.build_command("claude-opus-4-8", None, 3)
    assert cmd[cmd.index("--max-turns") + 1] == "5"  # 3 images + 2


def test_build_instruction_print_only_trailer():
    instr = claude_cli.build_instruction("Summarize", [])
    assert "Summarize" in instr
    assert "Do NOT write any files" in instr


def test_build_instruction_reads_each_image():
    instr = claude_cli.build_instruction("Describe", ["/tmp/a.png", "/tmp/b.png"])
    assert "Read and analyze the image at /tmp/a.png" in instr
    assert "Read and analyze the image at /tmp/b.png" in instr


def test_run_instruction_via_stdin_not_argv():
    captured = {}
    def fake(cmd, stdin):
        captured["cmd"], captured["stdin"] = cmd, stdin
        return (0, _ok_payload(), "")
    claude_cli.run("my long prompt", "cli-claude-opus-4-8", None, [], run_fn=fake)
    assert "my long prompt" in captured["stdin"]
    assert "my long prompt" not in " ".join(captured["cmd"])


def test_run_parses_ok_result():
    r = claude_cli.run("hi", "cli-claude-sonnet-4-6", None, [],
                       run_fn=lambda cmd, stdin: (0, _ok_payload("hello", 0.02, 3, 4), ""))
    assert r["status"] == "OK"
    assert r["text"] == "hello"
    assert r["usage"] == {"input_tokens": 3, "output_tokens": 4, "cost_usd": 0.02}


def test_parse_result_max_turns_surfaces_reason():
    # claude exits 1 BUT prints a valid JSON envelope. The reason must reach the user,
    # not be masked as a generic "claude exited 1".
    payload = json.dumps({
        "is_error": True, "subtype": "error_max_turns", "result": "",
        "errors": ["Reached maximum number of turns (2)"],
        "usage": {}, "total_cost_usd": 0.14,
    })
    r = claude_cli.parse_result(1, payload, "")
    assert r["status"] == "ERROR"
    assert "error_max_turns" in r["error"]
    assert "Reached maximum number of turns" in r["error"]


def test_run_nonzero_rc_no_json_uses_stderr():
    r = claude_cli.run("hi", "cli-claude-opus-4-8", None, [],
                       run_fn=lambda cmd, stdin: (1, "", "Invalid API key"))
    assert r["status"] == "ERROR"
    assert r["text"] == ""
    assert "Invalid API key" in r["error"]


def test_run_is_error_true():
    payload = json.dumps({"is_error": True, "subtype": "error_during_execution", "result": "", "usage": {}})
    r = claude_cli.run("hi", "cli-claude-opus-4-8", None, [], run_fn=lambda cmd, stdin: (0, payload, ""))
    assert r["status"] == "ERROR"


def test_run_empty_result_is_error():
    payload = json.dumps({"is_error": False, "result": "  ", "total_cost_usd": 0, "usage": {}})
    r = claude_cli.run("hi", "cli-claude-opus-4-8", None, [], run_fn=lambda cmd, stdin: (0, payload, ""))
    assert r["status"] == "ERROR"


def test_run_non_json_is_error():
    r = claude_cli.run("hi", "cli-claude-opus-4-8", None, [], run_fn=lambda cmd, stdin: (0, "boom", ""))
    assert r["status"] == "ERROR"


def test_route_dispatches_to_cli(monkeypatch):
    from fastapi.testclient import TestClient
    from src.api import app
    import src.routers.llm as llm

    captured = {}
    def fake_run(prompt, model_id, system, image_paths, run_fn=None,
                 skills_enabled=False, skill_names=None, effort=None):
        captured["model_id"] = model_id
        captured["prompt"] = prompt
        captured["images"] = image_paths
        captured["effort"] = effort
        return {"text": "hi", "status": "OK",
                "usage": {"input_tokens": 1, "output_tokens": 1, "cost_usd": 0.0}}

    monkeypatch.setattr(llm.claude_cli, "run", fake_run)
    client = TestClient(app)
    r = client.post("/api/llm/chat", data={"prompt": "yo", "model": "cli-claude-opus-4-8"})
    assert r.status_code == 200
    body = r.json()
    assert body["text"] == "hi"
    assert body["status"] == "OK"
    assert captured["model_id"] == "cli-claude-opus-4-8"
    assert captured["prompt"] == "yo"
    assert captured["images"] == []


def test_route_cli_error_returns_422(monkeypatch):
    from fastapi.testclient import TestClient
    from src.api import app
    import src.routers.llm as llm

    def fake_run(prompt, model_id, system, image_paths, run_fn=None,
                 skills_enabled=False, skill_names=None, effort=None):
        return {"text": "", "status": "ERROR", "error": "Claude CLI error_max_turns: Reached maximum number of turns (2)",
                "usage": {"input_tokens": 0, "output_tokens": 0, "cost_usd": 0.0}}

    monkeypatch.setattr(llm.claude_cli, "run", fake_run)
    client = TestClient(app)
    r = client.post("/api/llm/chat", data={"prompt": "yo", "model": "cli-claude-opus-4-8"})
    assert r.status_code == 422
    assert "error_max_turns" in r.json()["detail"]


def test_build_command_skills_enabled_widens_tools_and_turns():
    cmd = claude_cli.build_command("claude-opus-4-8", None, 0, skills_enabled=True)
    assert cmd[cmd.index("--tools") + 1] == "Skill Read Glob Grep WebSearch"
    assert cmd[cmd.index("--max-turns") + 1] == "8"


def test_build_command_skills_with_images_keeps_min_turns():
    cmd = claude_cli.build_command("claude-opus-4-8", None, 6, skills_enabled=True)
    # max(8, n_images + 4) = max(8, 10) = 10
    assert cmd[cmd.index("--max-turns") + 1] == "10"


def test_build_command_skills_disabled_unchanged():
    cmd = claude_cli.build_command("claude-opus-4-8", None, 0, skills_enabled=False)
    assert cmd[cmd.index("--tools") + 1] == ""
    assert cmd[cmd.index("--max-turns") + 1] == "2"


def test_build_instruction_with_skill_names_lists_them():
    instr = claude_cli.build_instruction("Hi", [], skill_names=["caveman", "react-patterns"])
    assert "Use only these Agent Skills if relevant: caveman, react-patterns." in instr
    assert "Do NOT write any files." in instr


def test_build_instruction_no_skill_names_unchanged():
    instr = claude_cli.build_instruction("Hi", [])
    assert "Respond with ONLY the result text. Do NOT write any files." in instr
    assert "Agent Skills" not in instr


def test_run_plumbs_skill_flags():
    captured = {}

    def fake_run(cmd, stdin):
        captured["cmd"] = cmd
        captured["stdin"] = stdin
        return 0, _ok_payload(), ""

    claude_cli.run("Hi", "cli-claude-opus-4-8", None, [],
                   run_fn=fake_run, skills_enabled=True, skill_names=["caveman"])
    assert captured["cmd"][captured["cmd"].index("--tools") + 1] == "Skill Read Glob Grep WebSearch"
    assert "caveman" in captured["stdin"]
