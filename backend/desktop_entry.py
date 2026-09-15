"""桌面模式入口（PyInstaller 打包入口）。

用法:
  TokenSpeed.exe                    正常启动窗口
  TokenSpeed.exe --hidden           以隐藏状态启动（开机自启场景，托盘"显示"唤起）
  TokenSpeed.exe --admin-password X 配置管理密码（优先于环境变量）
"""
import argparse
import logging
import os
import sys


def _parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Token Speed desktop")
    parser.add_argument("--hidden", action="store_true", help="启动后最小化到托盘")
    parser.add_argument("--admin-password", help="管理密码（优先于环境变量）")
    return parser.parse_args(argv)


def main() -> None:
    logging.basicConfig(level=logging.INFO)

    args = _parse_args(sys.argv[1:])
    if args.admin_password is not None:
        os.environ["TOKEN_SPEED_ADMIN_PASSWORD"] = args.admin_password

    from backend import main as backend_main
    from backend import desktop

    # main 模块导入时已根据 dist 存在与否挂载静态资源
    desktop.launch(backend_main.app, start_hidden=args.hidden, admin_password=args.admin_password)


if __name__ == "__main__":
    main()
