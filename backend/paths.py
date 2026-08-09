"""路径解析：区分 PyInstaller 冻结态与开发/服务器态。

frozen（桌面 exe）：
  - DB      → %APPDATA%\TokenSpeed\speed_tests.db（可写，持久化）
  - 前端资源 → _MEIPASS\frontend_dist（打包进 exe 的只读资源）

开发/服务器（python 直跑）：
  - DB      → backend\speed_tests.db（保持现状，不破坏服务器部署）
  - 前端资源 → frontend\dist（若已构建则挂载）
"""
import os
import sys

APP_NAME = "TokenSpeed"


def is_frozen() -> bool:
    return getattr(sys, "frozen", False)


def app_data_dir() -> str:
    """用户可写数据目录。"""
    base = os.environ.get("APPDATA") or os.path.expanduser("~")
    d = os.path.join(base, APP_NAME)
    os.makedirs(d, exist_ok=True)
    return d


def db_path() -> str:
    if is_frozen():
        return os.path.join(app_data_dir(), "speed_tests.db")
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), "speed_tests.db")


def frontend_dist_dir() -> str:
    if is_frozen():
        return os.path.join(sys._MEIPASS, "frontend_dist")
    repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(repo_root, "frontend", "dist")


def frontend_dist_exists() -> bool:
    dist = frontend_dist_dir()
    return os.path.isdir(dist) and os.path.isfile(os.path.join(dist, "index.html"))
