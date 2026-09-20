r"""桌面版构建脚本：前端构建 → PyInstaller 打包（→ 可选压缩发布 zip）。

用法:
  python build.py            # 构建前端 + 打包，产物 dist/TokenSpeed/
  python build.py --zip      # 追加压缩为 dist/TokenSpeed-v<版本>-win64.zip
"""
import argparse
import json
import os
import pathlib
import shutil
import subprocess
import sys
import zipfile

ROOT = pathlib.Path(__file__).parent.resolve()
FRONTEND = ROOT / "frontend"
DIST = ROOT / "dist"
APP_NAME = "TokenSpeed"


def run(cmd: list[str], cwd: pathlib.Path) -> None:
    # Windows 下 npm 等是 .cmd，需 which 解析全路径否则 CreateProcess 找不到
    cmd[0] = shutil.which(cmd[0]) or cmd[0]
    print(f"[build] {' '.join(cmd)}  (cwd={cwd.relative_to(ROOT)})")
    subprocess.run(cmd, cwd=cwd, check=True)


def build_frontend() -> None:
    run(["npm", "run", "build"], FRONTEND)


def package() -> None:
    run([sys.executable, "-m", "PyInstaller", "token-speed.spec", "--noconfirm", "--clean"], ROOT)


def read_version() -> str:
    return json.loads((FRONTEND / "package.json").read_text("utf-8"))["version"]


def make_zip() -> pathlib.Path:
    version = read_version()
    zip_path = DIST / f"{APP_NAME}-v{version}-win64.zip"
    if zip_path.exists():
        zip_path.unlink()
    src = DIST / APP_NAME
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for path in sorted(src.rglob("*")):
            zf.write(path, path.relative_to(src.parent))
    print(f"[build] zip: {zip_path}")
    return zip_path


def main() -> None:
    parser = argparse.ArgumentParser(description="TokenSpeed desktop build")
    parser.add_argument("--zip", action="store_true", help="打包后压缩为发布 zip")
    parser.add_argument("--frontend-only", action="store_true", help="只构建前端，不打包 exe")
    args = parser.parse_args()

    if not (FRONTEND / "node_modules").exists():
        run(["npm", "install"], FRONTEND)

    build_frontend()
    if args.frontend_only:
        return

    package()
    if args.zip:
        make_zip()

    print(f"[build] done: {DIST / APP_NAME}")


if __name__ == "__main__":
    main()
