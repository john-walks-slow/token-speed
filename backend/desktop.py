"""桌面壳：uvicorn(守护线程) + pywebview 窗口 + pystray 托盘。

仅 frozen(exe) 时启用；开发/服务器态仍用 vite/uvicorn 分离。
"""
import logging
import os
import socket
import sys
import threading
import time
import urllib.parse
import urllib.request

import uvicorn

log = logging.getLogger("desktop")

# 窗口关闭事件里若为 True 则真正退出，否则隐藏到托盘
_exit_flag = False


def _find_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _wait_for_server(base_url: str, timeout: float = 20.0) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(f"{base_url}api/stats", timeout=2):
                return True
        except Exception:
            time.sleep(0.2)
    return False


def _icon_path() -> str:
    if getattr(sys, "frozen", False):
        p = os.path.join(sys._MEIPASS, "icon.ico")
        return p if os.path.isfile(p) else ""
    # 开发态：仓库根目录 icon.ico（若有）
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    p = os.path.join(root, "icon.ico")
    return p if os.path.isfile(p) else ""


def _make_tray_image():
    """可辨识的绿色圆点托盘图标（无 icon.ico 时的占位）。"""
    from PIL import Image, ImageDraw

    size = 64
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    pad = 6
    # 绿色圆（匹配 app primary）
    draw.ellipse([pad, pad, size - pad, size - pad], fill=(34, 197, 94, 255))
    return img


def launch(app, start_hidden: bool = False, admin_password: str | None = None) -> None:
    import webview
    from pystray import Icon, Menu, MenuItem
    from PIL import Image

    port = _find_free_port()
    base_url = f"http://127.0.0.1:{port}/"

    # 持有 Server 引用，便于退出时优雅关闭（触发 lifespan stop）
    server_holder: dict[str, uvicorn.Server] = {}

    def _run_server() -> None:
        config = uvicorn.Config(
            app,
            host="127.0.0.1",
            port=port,
            log_level="warning",
            access_log=False,
            log_config=None,
        )
        server = uvicorn.Server(config)
        server_holder["server"] = server
        try:
            server.run()
        except Exception:
            log.exception("uvicorn crashed")

    server_thread = threading.Thread(target=_run_server, daemon=True)
    server_thread.start()

    if not _wait_for_server(base_url):
        log.error("server failed to start")
        return

    # 配置了管理密码时，桌面窗口自动带密码进入（登录门不弹框）
    window_url = base_url
    if admin_password:
        window_url = f"{base_url}?admin_password={urllib.parse.quote(admin_password)}"

    window = webview.create_window(
        "Token Speed",
        window_url,
        width=1280,
        height=800,
        min_size=(900, 600),
        hidden=start_hidden,
    )

    def on_closing():
        # 点 X → 隐藏到托盘继续后台运行；托盘"退出"时真正关闭
        if _exit_flag:
            return True
        threading.Thread(target=window.hide, daemon=True).start()
        return False

    def on_minimized():
        # 最小化同样隐藏到托盘（需求：最小化到后台）
        threading.Thread(target=window.hide, daemon=True).start()

    window.events.closing += on_closing
    window.events.minimized += on_minimized

    tray_icon_holder: dict[str, object] = {}

    def show_window(_icon, _item):
        window.show()

    def exit_app(_icon, _item):
        global _exit_flag
        _exit_flag = True
        # destroy 与 hide 一样需要跨线程安全，放独立线程避免挂起
        def _do_exit():
            try:
                window.destroy()
            except Exception:
                pass
            try:
                _icon.stop()
            except Exception:
                pass

        threading.Thread(target=_do_exit, daemon=True).start()

    def _tray_run():
        icon_path = _icon_path()
        try:
            image = Image.open(icon_path) if icon_path else _make_tray_image()
        except Exception:
            image = _make_tray_image()
        menu_items = [MenuItem("显示", show_window, default=True)]
        menu_items.append(MenuItem("退出", exit_app))

        icon = Icon(
            "TokenSpeed",
            image,
            "Token Speed",
            menu=Menu(*menu_items),
        )
        tray_icon_holder["icon"] = icon
        icon.run()

    threading.Thread(target=_tray_run, daemon=True).start()

    # 主线程运行 GUI 事件循环；窗口全部关闭后返回
    icon_path = _icon_path()
    webview.start(icon=icon_path or None)

    # 优雅关闭 uvicorn（触发 lifespan.scheduler.stop）
    server = server_holder.get("server")
    if server is not None:
        server.should_exit = True
    icon = tray_icon_holder.get("icon")
    if icon is not None:
        try:
            icon.stop()
        except Exception:
            pass
