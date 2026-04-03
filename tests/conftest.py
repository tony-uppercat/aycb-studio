"""Shared test fixtures for AYCB backend tests."""
import asyncio
import pytest
from pathlib import Path


@pytest.fixture
def tmp_db(tmp_path, monkeypatch):
    """Create a temp DB path and monkeypatch the review_hub db module."""
    import src.review_hub.db as db_mod
    monkeypatch.setattr(db_mod, "_DB_PATH", tmp_path / "test.db")
    return tmp_path / "test.db"


def _run(coro):
    """Helper to run async code in sync tests."""
    return asyncio.run(coro)
