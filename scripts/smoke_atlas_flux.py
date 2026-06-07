"""Cost-free probe of Atlas API. GET on a fake prediction id should return
- 401 if the key is invalid
- 404 with a structured "prediction not found" if endpoint + key are both valid
- 404 with "not found" generic if the endpoint path itself is wrong

Run: $env:AYCB_ATLAS_KEY="..."; python scripts/smoke_atlas_flux.py
"""
from __future__ import annotations

import os
import sys

import httpx

BASE = "https://api.atlascloud.ai/api/v1"


def hit(label: str, url: str, key: str) -> None:
    try:
        r = httpx.get(url, headers={"Authorization": f"Bearer {key}"}, timeout=20)
        body = (r.text or "")[:250].replace("\n", " ")
        print(f"[{r.status_code}] {label}\n        url:  {url}\n        body: {body}\n")
    except httpx.HTTPError as exc:
        print(f"[ERR] {label} → {exc}\n")


def main() -> int:
    key = os.environ.get("AYCB_ATLAS_KEY", "").strip()
    if not key:
        print("set AYCB_ATLAS_KEY first")
        return 1

    print(f"=== key …{key[-6:]} ===\n")

    hit("fake prediction (tests endpoint + key)",
        f"{BASE}/model/prediction/00000000-0000-0000-0000-000000000000", key)

    hit("root /api/v1 (any response = reachable)",
        f"{BASE}", key)

    hit("user/me (common auth-check endpoint)",
        f"{BASE}/user/me", key)

    hit("user (alt)", f"{BASE}/user", key)

    hit("account", f"{BASE}/account", key)

    return 0


if __name__ == "__main__":
    sys.exit(main())
