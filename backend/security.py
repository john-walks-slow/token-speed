"""管理密码认证：Bearer token 中间件。

未配置密码（`TOKEN_SPEED_ADMIN_PASSWORD`）时完全不要求认证，向后兼容；
配置后所有 /api 中非只读集路径需 `Authorization: Bearer <password>`。
只读开放集（mode/auth/status/stats/history/schedules/providers-public GET）
始终开放，供主端口匿名只读统计视图（DashboardApp）使用。
"""
import hmac
import os

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

_ENV_KEY = "TOKEN_SPEED_ADMIN_PASSWORD"

# 只读开放集（精确匹配）：mode/auth/status/stats；history 系列单独前缀匹配。
_OPEN_PATHS = (
    "/api/mode",
    "/api/auth/status",
    "/api/stats",
    "/api/schedules",
    "/api/providers/public",  # sanitize 版（api_key 置空），供匿名只读视图
)


def admin_password() -> str | None:
    """当前配置的管理密码；未配置返回 None（不要求认证）。"""
    value = os.environ.get(_ENV_KEY, "")
    return value or None


def is_open_request(method: str, path: str) -> bool:
    """GET 且路径属只读开放集 → 放行。其余请求（含其他 GET）受密码保护。"""
    return method == "GET" and (path in _OPEN_PATHS or path.startswith("/api/history"))


class AdminAuthMiddleware(BaseHTTPMiddleware):
    """密码已配置时拦截 /api 下的非开放请求；静态资源与只读集不拦截。"""

    async def dispatch(self, request: Request, call_next):
        password = admin_password()
        if password is None:
            return await call_next(request)

        path = request.url.path
        if not path.startswith("/api/") or is_open_request(request.method, path):
            return await call_next(request)

        auth = request.headers.get("Authorization", "")
        if not _valid_bearer(auth, password):
            return JSONResponse({"detail": "admin password required"}, status_code=401)
        return await call_next(request)


def _valid_bearer(authorization: str, password: str) -> bool:
    """Bearer 头校验，恒时比较避免时序侧信道。"""
    if not authorization.startswith("Bearer "):
        return False
    token = authorization[len("Bearer "):].strip()
    return hmac.compare_digest(token, password)
