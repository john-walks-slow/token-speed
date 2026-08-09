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
import webbrowser

import uvicorn

from . import dashboard as dashboard_mod

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


def _lan_addresses(port: int) -> list[str]:
    """本机各网卡地址下的看板 URL，供日志提示局域网访问入口（去重）。"""
    urls: set[str] = set()
    try:
        hostname = socket.gethostname()
        for info in socket.getaddrinfo(hostname, None):
            ip = info[4][0]
            if not ip.startswith("127.") and ":" not in ip:  # 跳过回环与 IPv6
                urls.add(f"http://{ip}:{port}/")
    except Exception:
        pass
    return sorted(urls) or [f"http://127.0.0.1:{port}/"]


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

    # 独立端口统计看板（0.0.0.0，局域网可访问；默认 8855，可 env/--dashboard-port 覆盖）
    dashboard_url = ""
    dash_cfg = dashboard_mod.dashboard_config()
    if dash_cfg["enabled"]:
        # 看板就绪标志：bind 失败（端口被占等）时置 False，托盘不显示不可用的入口
        dash_ok_holder: dict[str, bool] = {"ok": True}

        def _run_dashboard() -> None:
            config = uvicorn.Config(
                dashboard_mod.dashboard_app,
                host=dash_cfg["host"],
                port=dash_cfg["port"],
                log_level="warning",
                access_log=False,
                log_config=None,
            )
            server = uvicorn.Server(config)
            server_holder["dashboard"] = server
            try:
                server.run()
            except Exception:
                dash_ok_holder["ok"] = False
                log.exception("dashboard uvicorn crashed (port %s in use?)", dash_cfg["port"])

        threading.Thread(target=_run_dashboard, daemon=True).start()
        # 短暂等待 uvicorn 完成端口绑定（就绪或失败），再决定是否暴露入口
        deadline = time.time() + 2.0
        while time.time() < deadline and dash_ok_holder["ok"]:
            server = server_holder.get("dashboard")
            if server is not None and server.started:
                break
            time.sleep(0.05)
        if dash_ok_holder["ok"] and server_holder.get("dashboard") is not None:
            dashboard_url = f"http://127.0.0.1:{dash_cfg['port']}/"
            log.info(
                "dashboard exposed at %s (LAN: %s)",
                dashboard_url,
                ", ".join(_lan_addresses(dash_cfg["port"])),
            )
        else:
            log.warning("dashboard not exposed: port %s unavailable", dash_cfg["port"])

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

    def open_dashboard(_icon, _item):
        if dashboard_url:
            webbrowser.open(dashboard_url)

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
        if dashboard_url:
            menu_items.append(MenuItem("打开统计看板", open_dashboard))
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
    webview.start()

    # 优雅关闭 uvicorn（触发 lifespan.scheduler.stop）与看板
    server = server_holder.get("server")
    if server is not None:
        server.should_exit = True
    dash_server = server_holder.get("dashboard")
    if dash_server is not None:
        dash_server.should_exit = True
    icon = tray_icon_holder.get("icon")
    if icon is not None:
        try:
            icon.stop()
        except Exception:
            pass
