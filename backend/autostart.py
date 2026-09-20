"""开机自启：Windows 注册表 Run 键读写（桌面模式专用）。

桌面模式自启时，以 `--hidden` 参数启动 exe，避免开机弹窗。
开发/服务器模式调用这些函数时返回不可用。
"""
import sys
from pathlib import Path

RUN_KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"
# Task Manager / 设置里「禁用启动项」时 Run 值不删，改在此键写禁用标记（首字节 0x03/0x07）
APPROVED_KEY = r"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run"
VALUE_NAME = "TokenSpeed"


def supported() -> bool:
    """仅桌面(frozen)模式支持自启，且需 Windows。"""
    return sys.platform == "win32" and getattr(sys, "frozen", False)


def _launch_command() -> str:
    """自启命令：exe 路径 + --hidden 参数。"""
    exe = Path(sys.executable).resolve()
    return f'"{exe}" --hidden'


def _disabled_by_user() -> bool:
    """启动项是否被 Task Manager 禁用。"""
    import winreg

    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, APPROVED_KEY) as key:
            data, _ = winreg.QueryValueEx(key, VALUE_NAME)
        return bool(data) and data[0] in (3, 7)
    except OSError:
        return False


def is_enabled() -> bool:
    if not supported():
        return False
    import winreg

    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY) as key:
            value, _ = winreg.QueryValueEx(key, VALUE_NAME)
    except FileNotFoundError:
        return False
    # 路径不区分大小写，归一后再比（用户手动改过 regedit 大小写时不误报）
    return value.replace('"', "").lower() == str(Path(sys.executable).resolve()).lower() and not _disabled_by_user()


def set_enabled(enabled: bool) -> bool:
    """写入/删除 Run 键。返回是否成功。"""
    if not supported():
        return False
    import winreg

    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY, 0, winreg.KEY_SET_VALUE) as key:
            if enabled:
                winreg.SetValueEx(key, VALUE_NAME, 0, winreg.REG_SZ, _launch_command())
            else:
                try:
                    winreg.DeleteValue(key, VALUE_NAME)
                except FileNotFoundError:
                    pass
        return True
    except OSError:
        return False
