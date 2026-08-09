"""服务器部署入口：同进程双服务器（主应用 + 独立端口看板）。

用法:
  python -m backend.server

配置全部走环境变量（TOKEN_SPEED_ADMIN_PASSWORD / TOKEN_SPEED_DASHBOARD_*）。
主应用绑定 127.0.0.1，看板绑定 0.0.0.0（局域网可访问）。Ctrl+C 优雅退出。
"""
import signal
import threading

import uvicorn

from . import dashboard as dashboard_mod
from .main import app as main_app

MAIN_PORT = 8000

_servers: list[uvicorn.Server] = []


def _serve(app, host: str, port: int) -> None:
    config = uvicorn.Config(
        app,
        host=host,
        port=port,
        log_level="info",
        log_config=None,
    )
    server = uvicorn.Server(config)
    _servers.append(server)
    server.run()


def main() -> None:
    threads = [
        threading.Thread(target=_serve, args=(main_app, "127.0.0.1", MAIN_PORT), daemon=True),
    ]
    cfg = dashboard_mod.dashboard_config()
    if cfg["enabled"]:
        threads.append(
            threading.Thread(
                target=_serve,
                args=(dashboard_mod.dashboard_app, cfg["host"], cfg["port"]),
                daemon=True,
            )
        )
        print(f"[server] dashboard: http://0.0.0.0:{cfg['port']}/")

    for t in threads:
        t.start()

    stop = threading.Event()

    def _on_signal(_sig, _frame):
        stop.set()

    signal.signal(signal.SIGINT, _on_signal)
    signal.signal(signal.SIGTERM, _on_signal)

    # 主线程等待信号；收到后优雅关闭两个 server（触发 lifespan.scheduler.stop）
    try:
        while not stop.wait(1.0):
            pass
    except KeyboardInterrupt:
        pass
    for s in _servers:
        s.should_exit = True
    for t in threads:
        t.join(timeout=5)
    print("[server] shutting down")


if __name__ == "__main__":
    main()
