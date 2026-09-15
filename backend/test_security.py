"""管理密码中间件与单端口只读视图测试。

覆盖：开放集判定、未配置密码放行、配置后 Bearer 校验、公开 providers sanitize、
只读视图所需接口（schedules/stats/history）开放、完整 providers 受保护。
"""

import asyncio

import pytest
from fastapi.testclient import TestClient

from backend import database, security
from backend.main import app as main_app


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
        ("GET", "/api/schedules", True),        # 只读视图展示定时来源
        ("GET", "/api/providers/public", True), # sanitize 版（api_key 空）
        ("GET", "/api/providers", False),       # 完整版含 key，受保护
        ("GET", "/api/settings/network", False),
        ("POST", "/api/stats", False),          # 非 GET 一律不开放
        ("DELETE", "/api/history", False),
        ("GET", "/", False),                    # 非 /api 路径不参与（静态资源放行）
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


def test_admin_providers_protected(db, with_password):
    client = TestClient(main_app)
    # 完整 providers（含 key）未认证时 401
    r = client.get("/api/providers")
    assert r.status_code == 401
    # 配置密码后 sanitize 版仍开放
    r = client.get("/api/providers/public")
    assert r.status_code == 200


def test_read_only_open_when_configured(db, with_password):
    client = TestClient(main_app)
    # 只读集在配置密码后仍开放（无需 token）
    r = client.get("/api/stats")
    assert r.status_code == 200
    assert r.json()["total_tests"] == 0

    for path in ["/api/schedules", "/api/history"]:
        assert client.get(path).status_code == 200


def test_auth_status_reflects_configuration(db, with_password):
    client = TestClient(main_app)
    r = client.get("/api/auth/status")
    assert r.json() == {"required": True}


# ── 公开 providers：sanitize ───────────────────────────────────


def test_public_providers_sanitized(db, with_password):
    asyncio.run(database.create_provider(
        "p1", "https://api.example.com/v1", "sk-super-secret", ["gpt-4"]
    ))
    client = TestClient(main_app)
    r = client.get("/api/providers/public")
    assert r.status_code == 200
    body = r.json()
    assert len(body["providers"]) == 1
    assert body["providers"][0]["api_key"] == ""  # sanitize
    assert body["providers"][0]["name"] == "p1"

    # 完整版见不到密钥泄露给未认证方：受保护
    assert client.get("/api/providers").status_code == 401

    # 登录后可取完整 key
    r = client.get("/api/providers", headers={"Authorization": "Bearer secret"})
    assert r.status_code == 200
    assert r.json()["providers"][0]["api_key"] == "sk-super-secret"