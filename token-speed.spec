# -*- mode: python ; coding: utf-8 -*-
"""TokenSpeed 桌面版打包 spec。

前端先 npm run build（frontend/dist），本 spec 将其以 frontend_dist 名打包进 exe，
desktop.py 里 sys._MEIPASS/frontend_dist 读取。DB 放 %APPDATA% 由 paths.py 处理。
"""
import os
import sys

from PyInstaller.utils.hooks import collect_submodules

# PyInstaller 执行 spec 时不定义 __file__，用 SPECPATH（spec 所在目录）
root = os.path.abspath(SPECPATH)
frontend_dist = os.path.join(root, "frontend", "dist")

block_cipher = None

a = Analysis(
    [os.path.join(root, "backend", "desktop_entry.py")],
    pathex=[root],
    binaries=[],
    datas=[
        (frontend_dist, "frontend_dist"),
        *([(os.path.join(root, "icon.ico"), ".")] if os.path.isfile(os.path.join(root, "icon.ico")) else []),
    ],
    hiddenimports=collect_submodules("uvicorn")
    + collect_submodules("fastapi")
    + ["pystray", "PIL"],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=["tkinter", "unittest"],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="TokenSpeed",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,  # 无控制台窗口
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=os.path.join(root, "icon.ico") if os.path.isfile(os.path.join(root, "icon.ico")) else None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name="TokenSpeed",
)
