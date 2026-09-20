"""网络设置单元测试：默认值、持久化、校验、client_kwargs 映射、speed_test 注入。"""

import asyncio

import pytest

from backend import database, network_settings
from backend.network_settings import (
    get_network_settings,
    update_network_settings,
    client_kwargs,
)


@pytest.fixture
def db(tmp_path):
    """指向临时库，测试间重置线程本地连接与缓存。"""
    database.DB_PATH = str(tmp_path / "test.db")
    database._local.conn = None
    network_settings._cache = None
    yield
    conn = database._local.conn
    if conn is not None:
        conn.close()
        database._local.conn = None
    network_settings._cache = None


# ── 默认值 ─────────────────────────────────────────────────────


def test_defaults_when_empty(db):
    s = get_network_settings()
    assert s == {"proxy_mode": "system", "custom_proxy": "", "verify_ssl": True}
    # 空表时不写库
    rows = database._fetchall("SELECT key FROM settings")
    assert rows == []


# ── 持久化往返 ─────────────────────────────────────────────────


def test_update_roundtrip_system(db):
    asyncio.run(update_network_settings({
        "proxy_mode": "system", "custom_proxy": "", "verify_ssl": False,
    }))
    s = get_network_settings()
    assert s["proxy_mode"] == "system"
    assert s["verify_ssl"] is False
    # DB 有行
    rows = database._fetchall("SELECT key FROM settings")
    assert len(rows) == 3


def test_update_custom_with_url(db):
    asyncio.run(update_network_settings({
        "proxy_mode": "custom", "custom_proxy": "http://127.0.0.1:7890", "verify_ssl": True,
    }))
    s = get_network_settings()
    assert s["proxy_mode"] == "custom"
    assert s["custom_proxy"] == "http://127.0.0.1:7890"


def test_persists_after_cache_reset(db):
    asyncio.run(update_network_settings({
        "proxy_mode": "none", "custom_proxy": "", "verify_ssl": False,
    }))
    network_settings._cache = None
    s = get_network_settings()
    assert s["proxy_mode"] == "none"
    assert s["verify_ssl"] is False


# ── 校验 ───────────────────────────────────────────────────────


def test_invalid_mode_rejected(db):
    with pytest.raises(ValueError, match="invalid proxy_mode"):
        asyncio.run(update_network_settings({"proxy_mode": "banana"}))


def test_invalid_custom_url_rejected(db):
    with pytest.raises(ValueError, match="invalid custom proxy"):
        asyncio.run(update_network_settings({
            "proxy_mode": "custom", "custom_proxy": "not-a-url", "verify_ssl": True,
        }))


# ── client_kwargs 映射 ────────────────────────────────────────


@pytest.mark.parametrize(
    "mode,proxy,verify_ssl,expected",
    [
        ("system", "", True, {"proxy": None, "verify": True, "trust_env": True}),
        ("none", "", True, {"proxy": None, "verify": True, "trust_env": False}),
        ("custom", "http://127.0.0.1:7890", True,
         {"proxy": "http://127.0.0.1:7890", "verify": True, "trust_env": False}),
        ("system", "", False, {"proxy": None, "verify": False, "trust_env": True}),
        ("custom", "", True, {"proxy": None, "verify": True, "trust_env": False}),  # 空 URL 回退直连
    ],
)
def test_client_kwargs_mapping(db, mode, proxy, verify_ssl, expected):
    asyncio.run(update_network_settings({
        "proxy_mode": mode, "custom_proxy": proxy, "verify_ssl": verify_ssl,
    }))
    assert client_kwargs() == expected


# ── speed_test 注入验证 ───────────────────────────────────────


class FakeAsyncClient:
    """模拟 httpx.AsyncClient，记录构造参数和请求。"""

    def __init__(self, **kwargs):
        self.kwargs = kwargs
        self._resp_data = {"data": [{"id": "gpt-4", "owned_by": "openai"}]}

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        pass

    async def get(self, url, headers=None):
        class FakeResp:
            def raise_for_status(self): pass
            def json(self):
                return self._body
        r = FakeResp()
        r._body = self._resp_data
        return r

    async def post(self, url, json=None, headers=None):
        class FakeResp:
            status_code = 200
            request = None
            def raise_for_status(self): pass
            async def aread(self):
                # _raise_for_openai_error 在非 2xx 时读取响应体；成功路径为空 body
                self._content = b""
            def json(self):
                return {
                    "model": "gpt-4",
                    "usage": {"completion_tokens": 3},
                    "choices": [{"message": {"content": "hi"}}],
                }
        return FakeResp()


def test_list_models_applies_proxy(db, monkeypatch):
    asyncio.run(update_network_settings({
        "proxy_mode": "custom", "custom_proxy": "http://127.0.0.1:7890", "verify_ssl": False,
    }))

    captured = {}

    def fake_client(**kwargs):
        captured.update(kwargs)
        return FakeAsyncClient(**kwargs)

    monkeypatch.setattr("backend.speed_test.httpx.AsyncClient", fake_client)

    from backend.network_settings import client_kwargs
    from backend.speed_test import list_models
    ok, result = asyncio.run(list_models(
        "https://api.example.com/v1", "sk-test", client_kwargs=client_kwargs(),
    ))
    assert ok is True
    assert captured["proxy"] == "http://127.0.0.1:7890"
    assert captured["verify"] is False
    assert captured["trust_env"] is False


def test_run_speed_test_applies_proxy(db, monkeypatch):
    asyncio.run(update_network_settings({
        "proxy_mode": "none", "custom_proxy": "", "verify_ssl": True,
    }))

    captured = {}

    def fake_client(**kwargs):
        captured.update(kwargs)
        return FakeAsyncClient(**kwargs)

    monkeypatch.setattr("backend.speed_test.httpx.AsyncClient", fake_client)

    from backend.network_settings import client_kwargs
    from backend.speed_test import run_speed_test
    result = asyncio.run(run_speed_test(
        base_url="https://api.example.com/v1", model="gpt-4",
        client_kwargs=client_kwargs(),
    ))
    assert result["success"] is True
    assert captured["trust_env"] is False
    assert captured["proxy"] is None
