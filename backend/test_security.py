"""管理密码中间件与独立看板 app 测试。

覆盖：开放集判定、未配置密码放行、配置后 Bearer 校验、看板只读且 providers sanitize。
"""

import pytest
from fastapi.testclient import TestClient

from backend import database, security
from backend.main import app as main_app
from backend.dashboard import dashboard_app


@pytest.fixture
def db(tmp_path):
    """临时库 + 重置线程本地连接。"""
    database.DB_PATH = str(tmp_path / "test.db")
    database._local.conn = None
    yield
    conn = database._local.conn
    if conn is not None:
        conn.close()
        database._local.conn = None


# ── is_open_request 边界 ───────────────────────────────────────


@pytest.mark.parametrize(
    "method,path,expected",
    [
        ("GET", "/api/stats", True),
        ("GET", "/api/mode", True),
        ("GET", "/api/auth/status", True),
        ("GET", "/api/history", True),
        ("GET", "/api/history/abc", True),
        ("GET", "/api/providers", False),   # 管理 app 内受保护（含完整 key）
        ("GET", "/api/schedules", False),   # 列表也受保护（泄露调度配置）
        ("GET", "/api/settings/network", False),
        ("POST", "/api/stats", False),      # 非 GET 一律不开放
        ("GET", "/", False),                # 非 /api 路径不参与（静态资源放行）
    ],
)
def test_is_open_request(method, path, expected):
    assert security.is_open_request(method, path) is expected


# ── 中间件：未配置密码放行 ─────────────────────────────────────


def test_no_password_allows_admin_route(db, monkeypatch):
    monkeypatch.delenv("TOKEN_SPEED_ADMIN_PASSWORD", raising=False)
    client = TestClient(main_app)
    # 未配置密码 → 管理路由可直接访问
    r = client.get("/api/settings/network")
    assert r.status_code in (200, 405)  # 405 说明进了路由（无 GET 路由定义）；200 亦然
    # 不返回 401 即为放行
    assert r.status_code != 401


# ── 中间件：配置密码后 Bearer 校验 ─────────────────────────────


@pytest.fixture
def with_password(monkeypatch):
    monkeypatch.setenv("TOKEN_SPEED_ADMIN_PASSWORD", "secret")
    yield
    monkeypatch.delenv("TOKEN_SPEED_ADMIN_PASSWORD", raising=False)


def test_requires_token_when_configured(db, with_password):
    client = TestClient(main_app)
    r = client.get("/api/settings/network")
    assert r.status_code == 401


def test_rejects_wrong_token(db, with_password):
    client = TestClient(main_app)
    r = client.get("/api/settings/network", headers={"Authorization": "Bearer wrong"})
    assert r.status_code == 401


def test_accepts_correct_token(db, with_password):
    client = TestClient(main_app)
    r = client.get("/api/settings/network", headers={"Authorization": "Bearer secret"})
    assert r.status_code in (200, 405)  # 放行即通过中间件


def test_read_only_open_when_configured(db, with_password):
    client = TestClient(main_app)
    # 只读集在配置密码后仍开放（无需 token）
    r = client.get("/api/stats")
    assert r.status_code == 200
    assert r.json()["total_tests"] == 0


def test_auth_status_reflects_configuration(db, with_password):
    client = TestClient(main_app)
    r = client.get("/api/auth/status")
    assert r.json() == {"required": True}


# ── 看板 app：只读 + sanitize ──────────────────────────────────


def test_dashboard_mode(db):
    client = TestClient(dashboard_app)
    r = client.get("/api/mode")
    assert r.json() == {"mode": "dashboard"}


def test_dashboard_stats_ok(db):
    client = TestClient(dashboard_app)
    assert client.get("/api/stats").status_code == 200


def test_dashboard_providers_sanitized(db):
    import asyncio

    from backend.database import create_provider

    asyncio.run(create_provider("p1", "https://api.example.com/v1", "sk-super-secret", ["gpt-4"]))
    client = TestClient(dashboard_app)
    r = client.get("/api/providers")
    assert r.status_code == 200
    body = r.json()
    assert len(body["providers"]) == 1
    assert body["providers"][0]["api_key"] == ""  # sanitize
    assert body["providers"][0]["name"] == "p1"


def test_dashboard_has_no_admin_routes(db):
    """按构造看板不含管理接口：providers POST / settings 均 405/404 而非可用。"""
    client = TestClient(dashboard_app)
    assert client.post("/api/providers", json={"name": "x", "base_url": "http://x"}).status_code == 405
    assert client.delete("/api/history").status_code == 405
    assert client.get("/api/settings/network").status_code == 404
