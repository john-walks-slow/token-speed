"""桌面模式入口（PyInstaller 打包入口）。

用法:
  TokenSpeed.exe          正常启动窗口
  TokenSpeed.exe --hidden 以隐藏状态启动（开机自启场景，托盘"显示"唤起）
"""
import logging
import sys


def main() -> None:
    logging.basicConfig(level=logging.INFO)

    from backend import main as backend_main
    from backend import desktop

    # main 模块导入时已根据 dist 存在与否挂载静态资源
    start_hidden = "--hidden" in sys.argv[1:]
    desktop.launch(backend_main.app, start_hidden=start_hidden)


if __name__ == "__main__":
    main()
