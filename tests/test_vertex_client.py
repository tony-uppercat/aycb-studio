"""Tests for src/vertex_client.py — cached genai.Client factory."""
import pytest


def test_get_vertex_client_raises_without_gcp_project():
    """get_vertex_client raises ValueError if gcp_project is empty."""
    from src.vertex_client import get_vertex_client, reset_vertex_client
    from config.settings import settings

    reset_vertex_client()
    original = settings.gcp_project
    try:
        settings.gcp_project = ""
        with pytest.raises(ValueError, match="GCP project is not configured"):
            get_vertex_client()
    finally:
        settings.gcp_project = original
        reset_vertex_client()


def test_reset_vertex_client_is_idempotent():
    """Calling reset twice must not raise."""
    from src.vertex_client import reset_vertex_client
    reset_vertex_client()
    reset_vertex_client()  # no error


def test_get_vertex_client_caches_instance(monkeypatch):
    """Second call returns the same client without re-instantiating."""
    from src import vertex_client
    from config.settings import settings

    vertex_client.reset_vertex_client()
    original = settings.gcp_project
    settings.gcp_project = "fake-project"
    try:
        fake_instance = object()
        monkeypatch.setattr(vertex_client, "_create_client", lambda: fake_instance)
        a = vertex_client.get_vertex_client()
        b = vertex_client.get_vertex_client()
        assert a is b is fake_instance
    finally:
        settings.gcp_project = original
        vertex_client.reset_vertex_client()
