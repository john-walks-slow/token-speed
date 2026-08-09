"""网络设置：代理与 TLS 校验。SQLite settings 表持久化 + 进程内缓存。"""

from urllib.parse import urlparse

from . import database

DEFAULTS = {"proxy_mode": "system", "custom_proxy": "", "verify_ssl": True}
_VALID_MODES = {"system", "custom", "none"}

_cache: dict | None = None


def _load() -> dict:
    global _cache
    data = dict(DEFAULTS)
    for r in database._fetchall("SELECT key, value FROM settings"):
        if r["key"] == "verify_ssl":
            data["verify_ssl"] = r["value"] == "1"
        elif r["key"] in data:
            data[r["key"]] = r["value"]
    _cache = data
    return data


def get_network_settings() -> dict:
    """返回当前网络设置拷贝。空表时返回默认值，不写库。"""
    return dict(_cache if _cache is not None else _load())


def _validate(fields: dict) -> dict:
    mode = fields.get("proxy_mode", DEFAULTS["proxy_mode"])
    if mode not in _VALID_MODES:
        raise ValueError(f"invalid proxy_mode: {mode!r}")
    data = {
        "proxy_mode": mode,
        "custom_proxy": (fields.get("custom_proxy") or "").strip(),
        "verify_ssl": bool(fields.get("verify_ssl", DEFAULTS["verify_ssl"])),
    }
    if mode == "custom" and data["custom_proxy"]:
        u = urlparse(data["custom_proxy"])
        if u.scheme not in ("http", "https", "socks5", "socks5h", "socks4") or not u.hostname:
            raise ValueError("invalid custom proxy URL")
    return data


async def update_network_settings(fields: dict) -> dict:
    """校验并更新网络设置，写 DB + 换缓存。"""
    data = _validate(fields)
    for key, value in data.items():
        stored = "1" if value is True else ("0" if value is False else str(value))
        database._run(
            "INSERT INTO settings (key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (key, stored),
        )
    global _cache
    _cache = data
    return dict(data)


def client_kwargs() -> dict:
    """映射为 httpx.AsyncClient 的 proxy/verify/trust_env 参数。"""
    s = get_network_settings()
    verify = s["verify_ssl"]
    if s["proxy_mode"] == "none" or s["proxy_mode"] == "custom" and not s.get("custom_proxy"):
        return {"proxy": None, "verify": verify, "trust_env": False}
    if s["proxy_mode"] == "custom":
        return {"proxy": s["custom_proxy"], "verify": verify, "trust_env": False}
    # system（默认）
    return {"proxy": None, "verify": verify, "trust_env": True}
