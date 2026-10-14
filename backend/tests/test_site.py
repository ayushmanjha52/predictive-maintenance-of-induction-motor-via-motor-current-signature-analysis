"""Single-process mode (FRONTEND_DIST set): site at /, API under /api."""

import importlib
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import main  # noqa: E402


@pytest.fixture(scope="module")
def site_client(tmp_path_factory):
    dist = tmp_path_factory.mktemp("dist")
    (dist / "index.html").write_text("<!doctype html><title>app</title>", encoding="utf-8")
    (dist / "assets").mkdir()
    (dist / "assets" / "app-abc123.js").write_text("console.log(1)", encoding="utf-8")
    (dist / "robots.txt").write_text("User-agent: *", encoding="utf-8")

    mp = pytest.MonkeyPatch()
    mp.setenv("FRONTEND_DIST", str(dist))
    importlib.reload(main)
    with TestClient(main.app, base_url="http://localhost") as c:
        yield c
    mp.undo()
    importlib.reload(main)  # back to API-only mode for any later tests


def test_app_routes_serve_index(site_client):
    for path in ("/", "/validation", "/detection-limit", "/about", "/privacy"):
        r = site_client.get(path)
        assert r.status_code == 200 and "<title>app</title>" in r.text, path
        csp = r.headers["content-security-policy"]
        assert "script-src 'self'" in csp and "frame-ancestors 'none'" in csp


def test_unknown_page_is_real_404(site_client):
    r = site_client.get("/no-such-page")
    assert r.status_code == 404 and "<title>app</title>" in r.text


def test_api_lives_under_api(site_client):
    assert site_client.get("/api/health").json() == {"status": "ok"}
    assert site_client.get("/api/validation").status_code == 200
    r = site_client.get("/api/nope")
    assert r.status_code == 404 and r.json()["error"]["code"] == "not_found"
    assert "default-src 'none'" in r.headers["content-security-policy"]


def test_static_files_and_caching(site_client):
    assert site_client.get("/robots.txt").text == "User-agent: *"
    r = site_client.get("/assets/app-abc123.js")
    assert r.status_code == 200 and "immutable" in r.headers["cache-control"]


@pytest.mark.parametrize("path", ["/../main.py", "/..%2Fmain.py", "/%2e%2e/%2e%2e/backend/main.py"])
def test_no_path_traversal(site_client, path):
    r = site_client.get(path)
    assert "import" not in r.text  # never the source of main.py
