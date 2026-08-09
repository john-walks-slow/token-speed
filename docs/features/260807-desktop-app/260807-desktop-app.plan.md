# 桌面化改造计划 — 260807-desktop-app

## 背景

当前项目是 FastAPI(Python) + React/Vite 前后端分离架构，通过 `start.bat` / `release.bat` 分别启动 uvicorn 与 vite 两个进程。目标：

1. 打包成单个 Windows 桌面应用（单 exe 目录），双击运行，无需安装 Python/Node。
2. 新增能力：**开机自启**、**最小化到系统托盘后台运行**（调度器继续执行定时测速）。
3. **保留原服务器部署能力**：`start.bat` 开发模式与 uvicorn 直跑方式继续可用。

## 技术选型

| 维度 | 选择 | 理由 |
|---|---|---|
| 桌面壳 | **pywebview 6.x** (edgechromium/WebView2) | 后端是 Python，零业务重写；Win10/11 原生自带 WebView2，不背 Chromium。已验证生产案例（Diaricat/QSOCapture 同架构） |
| 托盘 | **pystray** | Windows 托盘图标 + 菜单，配合 pywebview `events.closing/minimized` 实现后台运行 |
| 打包 | **PyInstaller onedir** | onedir 启动快、静态资源无解压延迟、DB 可写。不用 onefile |
| 端口 | 动态空闲端口 + 写 port 文件 | 避免 8000 被占用；WebView 与 API 同源 |

放弃方案：Electron（100MB+，Python 需 sidecar，Node 生态负担）、Tauri（需 Rust 工具链，两套构建链，对本规模工具不值得）。

## 架构

```
开发模式(保留)：
  start.bat ─┬─ uvicorn :8000 (backend.main:app)
             └─ vite dev  :5173 (frontend, proxy /api → 8000)

桌面模式(新增)：
  TokenSpeed.exe
  ├─ 主线程: webview 窗口 (WebView2, http://127.0.0.1:<port>)
  ├─ daemon 线程: uvicorn :<port> (backend.main:app)
  │    ├─ /api/*            → 现有路由
  │    ├─ /                 → mount frontend/dist 静态资源 (SPA)
  │    └─ /api/settings/autostart → 自启开关 API
  └─ daemon 线程: pystray 托盘 (显示/退出菜单)
       关闭(X) → 隐藏到托盘继续后台运行
```

前端相对路径 `/api` 天然同源，**无需修改任何前端 API 代码**。

## 使用路径

1. **首次使用**：双击 `TokenSpeed.exe` → 启动后端（守护线程）→ 打开桌面窗口 → 正常测速/配置。窗口关闭(X) → 隐藏到托盘，定时测速继续。
2. **后台运行**：点击托盘图标 → "显示" 唤回窗口；右键托盘 → "退出" 完全退出（含停止调度器）。
3. **开机自启**：窗口内设置开关（默认关）→ 写入 `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` → 下次登录自动启动并最小化到托盘。
4. **服务器部署（不变）**：仍可用 `start.bat` 开发，或 `uvicorn backend.main:app --port 8000` 独立部署；无窗口模式不依赖桌面壳。

## 改动清单

### 新增

| 文件 | 内容 |
|---|---|
| `backend/desktop.py` | 桌面入口。解析 exe 路径 → `main.py` 模块级挂载前端静态资源 → 找空闲端口 → 起 uvicorn 守护线程 → 等端口就绪 → 起 pystray 托盘线程 → `webview.create_window` 打开窗口。处理 `closing/minimized` 事件（hide 到托盘，注意 hide 放独立线程避免挂起）。`webview.start()` 主循环 |
| `backend/autostart.py` | 开机自启：Windows Registry `HKCU\...\Run` 读写 + 删除。提供 `is_enabled()/set_enabled(bool)` |
| `backend/paths.py` | 路径解析：`is_frozen()`（PyInstaller `sys._MEIPASS`）、应用数据目录 `%LOCALAPPDATA%\TokenSpeed`、前端 dist 路径（开发态 `frontend/dist`，打包态 `_MEIPASS/frontend_dist`） |
| `build.bat` | 一键构建：`npm run build` → 把 `frontend/dist` 复制为打包用目录 → PyInstaller onedir |
| `token-speed.spec` | PyInstaller spec：`--add-data` 前端构建产物、`collect_submodules('uvicorn')`、排除不需要的依赖 |
| `backend/desktop_entry.py` | PyInstaller 入口脚本（`if __name__ == "__main__": desktop_main()`），避免 `desktop.py` 被误识别为主模块 |

### 修改

| 文件 | 改动 |
|---|---|
| `backend/main.py` | 新增模块级 `mount_frontend(dist_dir)`：`app.mount("/", StaticFiles(directory=..., html=True))`。仅在桌面模式（`os.environ.get("TOKEN_SPEED_DESKTOP")` 或 dist 存在）时挂载；`/api` 路由定义之后挂载。lifespan 增加：非桌面模式 scheduler 照常；桌面模式由 `desktop.py` 管理。**CORS 收紧为白名单**（见技术决策 1） |
| `backend/database.py` | `DB_PATH` 改为 `paths.app_data_dir()/speed_tests.db`；**数据迁移**：若旧 `backend/speed_tests.db` 存在且新位置无库，则复制过去（首启迁移，不破坏服务器部署时的旧库） |
| `backend/models.py` | 新增 `AutostartResponse` / `AutostartUpdate` Pydantic 模型 |
| `frontend/src/App.tsx` | 新增"设置"Tab（或侧边栏入口）：开机自启 Switch，调 `GET/PUT /api/settings/autostart` |
| `frontend/src/lib/api.ts` | 新增 `getAutostart()/setAutostart()` 封装 |
| `frontend/src/types.ts` | 新增 `AutostartSettings` 类型 |
| `backend/scheduler.py` | 确认后台运行无阻塞（asyncio 已线程无关，仅确认 lifespan 正确） |

### 无需改动

- `frontend/src/lib/api.ts` 的 BASE（相对路径 `/api`，同源天然工作）
- `start.bat`（保留）
- 前端路由、SSE 流式（fetch 相对路径即可）

## 关键技术决策

1. **静态托管 + CORS 收紧为白名单**：桌面模式下 FastAPI 托管 dist，前端同源。CORS 从 `*` 改为 `allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$"`，覆盖开发(5173)、桌面动态端口、旧 preview(4173) 全部本机来源；服务器部署 API 仍可被本机前端调用，但不向任意外部来源开放（原 `*` 是安全隐患，本工具无公网跨源需求）。
2. **动态端口**：uvicorn `--port 0` 不可直接取用端口，改用 `socket` 找空闲端口 → 传给 uvicorn Config → `base_url = f"http://127.0.0.1:{port}/"` 传给 webview。写 `port` 到内存/文件供前端探测。
3. **`events.closing` 中 `window.hide()` 会挂起**：pywebview 已知 bug，必须放独立 `Thread(target=window.hide).start()` 并返回 `False` 取消关闭。托盘"退出"时置 `exit_flag=True`，`closing` 返回 `not exit_flag`。
4. **DB 迁移**：桌面首启把 `backend/speed_tests.db` 复制到 `%LOCALAPPDATA%\TokenSpeed\speed_tests.db`，避免用户丢失既有测速数据。服务器模式路径不变。
5. **PyInstaller hiddenimports**：uvicorn 动态加载，spec 中 `collect_submodules('uvicorn')` + `collect_submodules('fastapi')`；`--add-data` 前端 dist 到 `frontend_dist`。
6. **开机自启**：Registry `Run` 键写入 exe 绝对路径（引用 `sys.executable`）。需在设置中提供开/关，开关时校验路径可写。托盘模式自启时窗口 `hidden=True` 启动，避免开机弹窗。

## 验证清单（validation）

- [ ] `start.bat` 开发模式仍工作（前后端分离）
- [ ] `uvicorn backend.main:app --port 8000` 独立部署仍工作（含 /api）
- [ ] 桌面 exe 启动后窗口打开，测速/历史/统计/定时全功能可用
- [ ] 关闭(X) 后隐藏到托盘，定时测速继续执行
- [ ] 托盘菜单"显示"唤回窗口、"退出"完全退出
- [ ] 开机自启开关写/读注册表正确；勾选后重启登录自动启动到托盘
- [ ] 旧 `backend/speed_tests.db` 数据迁移到新位置

## 追加需求（用户中途补充）

1. **路由支持** — 每个 Tab 独立 URL，刷新不丢、前进/后退可用。采用自研 hash 路由（`frontend/src/lib/router.ts`），不引入 react-router：项目仅 5 个 Tab 无复杂路由需求，hash 在桌面 app 无需后端 fallback，避免过度设计。若未来需要代码分割/嵌套路由再迁移 react-router。
2. **修复空白时滚动条** — `index.css` 中 `body{overflow-y:auto}` + `html{height:100%}`，内容不足视口时不显示滚动条，超高时才出现。
3. **modern 滚动条** — WebKit 自定义滚动条（细、圆角、主题色 thumb），Firefox `scrollbar-width:thin`。
4. **深浅色模式** — 默认跟随系统（`prefers-color-scheme`），设置 Tab 可强制 light/dark，localStorage 持久化。`frontend/src/lib/theme.ts` 负责应用，`html[data-theme]` + CSS 变量双主题。

## 风险与备注

- PyInstaller 体积约 40-60MB（含 Python + FastAPI + pywebview）。onedir 模式启动 <1s。
- Windows Defender/SmartScreen 可能对未签名 exe 报警（用户自用可忽略，文档注明）。
- 若机器无 WebView2（Win10 老版本），需 `--add-binary` 或提示安装。Win10/11 现代版本默认自带。
- pystray 的 `Icon.run()` 在 Windows 可 daemon 线程运行（官方文档确认），避免 macOS fork 问题。
