"""独立端口统计看板 app：只读，无管理面。

仅挂 read_router（stats/history/mode/schedules），按构造不含任何管理接口；
providers 以 sanitize 版提供（api_key 置空），供前端分组/命名用。
与主应用同进程共享同一份前端 dist 与 SQLite。
"""
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .database import list_providers
from .main import read_router
from .models import ProviderListResponse, ProviderResponse
from . import paths

DEFAULT_PORT = 8855


def dashboard_config() -> dict:
    """读环境变量返回看板监听配置。disabled=1 时看板不启动。"""
    host = os.environ.get("TOKEN_SPEED_DASHBOARD_HOST", "0.0.0.0")
    port = int(os.environ.get("TOKEN_SPEED_DASHBOARD_PORT", str(DEFAULT_PORT)))
    disabled = os.environ.get("TOKEN_SPEED_DASHBOARD_DISABLED", "") == "1"
    return {"host": host, "port": port, "enabled": not disabled}


dashboard_app = FastAPI(title="Token Speed Dashboard", version="1.0.0")

# 看板可被局域网访问，前端资源同源；CORS 保持 localhost 白名单策略一致
dashboard_app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 看板专属 mode 先注册（先匹配），覆盖 read_router 中的 full
@dashboard_app.get("/api/mode")
async def dashboard_mode():
    """看板 app 的 mode：前端据此渲染只读看板。"""
    return {"mode": "dashboard"}


# 只读集：stats/history/schedules（列表）
dashboard_app.include_router(read_router)


@dashboard_app.get("/api/providers", response_model=ProviderListResponse)
async def get_providers_public():
    """sanitize 版 providers：仅供前端展示（分组/命名/标签），api_key 一律清空。"""
    providers = [ProviderResponse(**p) for p in await list_providers()]
    for p in providers:
        p.api_key = ""
    return ProviderListResponse(providers=providers)


def mount_frontend() -> None:
    if not paths.frontend_dist_exists():
        return
    dashboard_app.mount(
        "/", StaticFiles(directory=paths.frontend_dist_dir(), html=True), name="frontend"
    )


mount_frontend()
