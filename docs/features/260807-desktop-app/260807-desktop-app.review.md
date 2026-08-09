# 检视报告

## 概要

本次检视覆盖 Token Speed 桌面化改造（pywebview + pystray + PyInstaller 打包、开机自启、最小化到托盘、CORS 收紧、DB 迁移）及同步追加的前端增强（自研 hash 路由、深浅色主题、设置面板主题选择 UI）。涉及新增文件 `paths.py` / `autostart.py` / `desktop.py` / `desktop_entry.py` / `token-speed.spec` / `build.bat` / `router.ts` / `theme.ts` 及对 `main.py` / `database.py` / `api.ts` / `types.ts` / `App.tsx` / `SettingsPanel.tsx` / `index.css` / `requirements.txt` 的修改。整体架构清晰、与计划基本对齐、改动范围克制；线程模型、CORS、打包 spec、hash 路由、主题的核心思路正确。存在 1 个阻塞问题（winreg 顶层导入使非 Windows 服务器模式不可用），以及若干建议修改项。

## 需求对齐

- 需求目标（单 exe 桌面应用、开机自启、最小化到托盘后台运行、保留服务器部署能力）在代码层面均有对应实现，覆盖完整。
- 与计划的主要偏差：计划写 DB 目录为 `%LOCALAPPDATA%\TokenSpeed`，实现用的是 `%APPDATA%\TokenSpeed`（paths.py:23、database.py:15）。两者在 Windows 均可用，但与计划文档不一致，且 spec 文件 docstring 也写的 `%APPDATA%`。建议统一表述或更新计划。
- 计划提到「lifespan 增加：非桌面模式 scheduler 照常；桌面模式由 desktop.py 管理」，实际 `main.py` 的 lifespan 在所有模式下都照常 start/stop scheduler，未对桌面模式做特殊处理。这对功能无影响（桌面模式也需要 scheduler 后台跑定时测速），但与计划描述有出入，应更新计划措辞。
- 计划提到 `models.py` 新增 `AutostartResponse`/`AutostartUpdate`，实际这些 Pydantic 模型直接定义在 `main.py` 内（AutostartSettings/AutostartUpdate）。不影响功能，属实现细节偏离，可接受。
- 验证清单完整，覆盖桌面基础、开机自启、服务器保留三组场景。
- 新增前端 4 项（hash 路由、深浅主题、设置面板主题 UI、CSS 主题变量）未在原 plan 文档中列出，属开发过程中追加的体验增强。功能自洽，与桌面化主需求无耦合，可独立验证。建议后续补一条计划/总结记录该范围扩展。

## 阻塞问题

| ID | 位置 | 问题 | 建议 |
| --- | --- | --- | --- |
| B1 | `backend/autostart.py:11` | 模块顶层 `import winreg` 为无条件导入。`main.py:43` 在顶层 `from . import autostart`，导致 `main.py` 在非 Windows（或无 winreg 的解释器）导入即崩溃。虽当前部署目标是 Windows，但服务器模式应保持平台无关；且一旦将来在 WSL/Linux 容器跑 uvicorn 即直接挂掉，违反「保留服务器部署能力」需求。 | 将 `import winreg` 移到 `is_enabled`/`set_enabled`/`supported` 函数内部（lazy import），或用 try/except ImportError 包裹并在 `supported()` 中返回 False。这样非 Windows 下 `main.py` 可正常导入、其余 API 正常工作，仅自启相关接口返回 `supported=false`。 |

## 建议修改

| ID | 位置 | 问题 | 建议 |
| --- | --- | --- | --- |
| S1 | `backend/desktop.py:103-107` `exit_app` | 托盘"退出"从 pystray 线程调用 `window.destroy()`，这是跨线程 GUI 调用。计划明确记录了 `window.hide()` 跨线程会挂起需放独立线程，`destroy()` 同理存在风险。pystray 菜单回调运行在 pystray 自己的线程，非 webview GUI 线程。 | 改为通过 `webview` 提供的线程安全方式调度关闭，或参考 hide 的做法把 `window.destroy()` 放到独立线程执行后 `_icon.stop()`。需实机验证 destroy 不挂起。 |
| S2 | `backend/desktop.py:27-41` `_run_server` + `launch` 退出路径 | 桌面退出时仅 `_icon.stop()` + `window.destroy()`，`webview.start()` 返回后函数即返回，uvicorn 守护线程被进程退出强杀，`lifespan` 的 shutdown（含 `scheduler.stop()`）不执行。虽然 `mark_schedule_stale_running` 在启动时兜底了 running 状态，但属于「正常路径跳过优雅关闭」。 | 在 `launch` 返回前（`webview.start()` 之后）调用 `server.should_exit = True` 或 `server.shutdown()` 触发 uvicorn 优雅退出，使 lifespan shutdown 正常执行，避免日志/状态半截。需要 `_run_server` 把 `server` 对象暴露出来（返回值或闭包变量）。 |
| S3 | `backend/desktop_entry.py:19` + `backend/desktop.py:61` | `desktop.launch(backend_main.app, "", ...)` 传入 `frontend_dist=""`，但 `launch` 签名有 `frontend_dist: str` 参数且函数体内从未使用它（前端挂载在 `main.py` 导入时由 `mount_frontend()` 完成）。冗余参数易误导。 | 移除 `launch` 的 `frontend_dist` 参数，或在注释中说明该参数已废弃。保持签名与实现一致。 |
| S4 | `backend/desktop.py:54-58` `_icon_path` | 桌面版引用 `sys._MEIPASS/icon.ico`，但仓库根目录无 `icon.ico` 文件（Glob 确认不存在）。spec 中 icon 为可选（`if os.path.isfile`），`_icon_path` 回退到 1x1 透明像素，托盘图标对用户不可见，体验差。 | 提供一个实际 `icon.ico` 放入仓库根并在 spec `datas` 中 `--add-data` 打包，或至少用 pystray 内置可辨识占位图（非全透明）。否则用户看不到托盘图标，"隐藏到托盘"等于"消失"。 |
| S5 | `backend/desktop.py:90-92` `on_minimized` | 最小化即 `window.hide()`，无判断当前是否已隐藏，可能重复 hide。更重要的是：最小化到托盘后，用户点任务栏无法恢复，只能靠托盘"显示"。这对桌面用户是反直觉交互（常规期望是最小化到任务栏）。 | 确认这是有意设计（计划确实说"最小化到后台"）。若是有意，建议在首次最小化时给一次性提示"已隐藏到托盘"；若不是，考虑只对 closing(X) 隐藏、最小化保留任务栏。需与需求方确认。 |
| S6 | `backend/main.py:58-65` CORS regex | regex `^https?://(localhost|127\.0\.0\.1)(:\d+)?$` 能覆盖 dev(5173)、preview(4173)、桌面动态端口。但 `allow_credentials=True` 配合 regex 白名单时，若将来有人用 `0.0.0.0` 或机器名访问会被静默拦掉。当前本机工具场景没问题。 | 可接受。若希望更宽松可加 `0\.0\.0\.0` 和机器名，但当前无需求。记录备忘。 |
| S7 | `backend/desktop.py:43-51` `_wait_for_server` | 轮询 `/api/stats`，若该路由在 server 尚未挂载前端前报 404/500 会误判。实际 `/api/stats` 是固定路由，应正常 200。但 20s 超时偏长，用户启动时若失败会长时间无反馈（窗口不出现也不报错，直接 return）。 | 失败时除 log.error 外，建议弹一个系统通知或托盘提示，避免用户双击 exe 后无任何反馈。或在窗口里显示错误页。 |
| S8 | `backend/autostart.py:22-25` `_launch_command` | 用 `Path(sys.executable).resolve()` 后拼带引号命令。`sys.executable` 在 PyInstaller onedir 下指向 `TokenSpeed.exe`，正确。但若 exe 被移动到含特殊字符（如含逗号）的路径，注册表 REG_SZ 仍可承载，无大碍。`is_enabled` 做精确字符串比较，用户手动移动 exe 后注册表旧值不匹配，开关显示为关但注册表残留旧值。 | 可接受（属已知权衡）。建议在 `set_enabled(False)` 之外，`is_enabled` 可考虑只判断键是否存在而非精确匹配，或文档注明移动 exe 后需重新切换开关。 |
| S9 | `frontend/src/lib/theme.ts:37-45` `initTheme` | `mql.addEventListener("change", ...)` 监听器从不移除。`initTheme` 在 `App.tsx` 的 `useEffect([], ...)` 中调用，生产单次挂载无问题；但 React 18 StrictMode 开发态双调用、或组件重挂载会叠加多个监听器，造成内存/行为泄漏。且 `initTheme` 无返回值，调用方无法拿到清理函数。 | 让 `initTheme` 返回一个 `() => void` cleanup（`mql.removeEventListener`），在 `App.tsx` 的 effect 里 `return initTheme()`，使 effect 清理与 React 生命周期一致。 |
| S10 | `frontend/src/lib/theme.ts` + `index.css` + `App.tsx:44-46` | 主题在 React 挂载后的 `useEffect` 里应用，而 `@theme`/`:root` 默认为暗色变量。首次加载（尤其刷新到浅色模式用户）会先以暗色渲染一帧再切换为浅色，产生闪屏（FOUC）。 | 在 `index.html` 的 `<head>` 内联一小段同步脚本，在 React 之前读 localStorage 并设 `document.documentElement[data-theme]`，消除首帧闪烁。这是主题持久化的 canonical 做法。 |

## 非阻塞问题

| ID | 位置 | 问题 | 建议 |
| --- | --- | --- | --- |
| N1 | `backend/desktop.py:21-24` `_find_free_port` | bind(0) 后取端口再交给 uvicorn，存在 TOCTOU 竞态（极小概率端口被占）。本机单实例场景可接受。 | 可接受，记录备忘。 |
| N2 | `backend/desktop.py:64-65` | `base_url` 带尾斜杠 `http://127.0.0.1:{port}/` 传给 `webview.create_window`。pywebview 通常能处理，但个别 WebView2 版本对尾斜杠行为敏感。 | 实机验证即可；若出现空白页可去掉尾斜杠。 |
| N3 | `frontend/src/components/SettingsPanel.tsx:58-63` | 开机自启用原生 `<input type="checkbox">` 而非项目已有的 shadcn Switch 控件，与项目其他表单（如 ScheduleForm）控件风格不一致。 | 统一用 shadcn `Switch` 组件，保持 design system 一致。 |
| N4 | `backend/desktop.py:109-121` `_tray_run` | `Image.open(icon_path) if icon_path else Image.new(...)`，open 失败（文件损坏）会抛异常导致托盘线程崩溃、进程无托盘。 | 加 try/except 回退到透明占位图。 |
| N5 | `token-speed.spec:25-27` hiddenimports | `collect_submodules("uvicorn")` + `collect_submodules("fastapi")` + `["pystray","PIL"]`。pywebview 未显式 collect，依赖 PyInstaller hook 自动发现。多数情况 OK，但 pywebview 的 `clr`/`EdgeChromium` 后端偶有动态导入遗漏。 | 首次构建后实机启动验证窗口能打开；若白屏，补 `collect_submodules("webview")`。 |
| N6 | `build.bat` | 构建前未校验 `frontend/node_modules` 存在，若未 `npm install` 直接跑 build.bat 会失败但提示不够友好。 | 可在 npm run build 前加 `if not exist node_modules call npm install`。非阻塞。 |
| N7 | `backend/database.py:20-31` 迁移逻辑 | 仅检查 exe 旁 `speed_tests.db` 与 `backend/speed_tests.db` 两个位置。若用户从旧 onefile 版（DB 在 %TEMP% 解压目录）升级，无法迁移。当前无 onefile 历史，可接受。 | 记录备忘，未来若提供过 onefile 版需补充迁移源。 |
| N8 | `backend/desktop.py:18` | 模块级 `_exit_flag` 全局变量，`exit_app` 内 `global _exit_flag` 修改。模块级可变状态在小规模可接受，但多窗口场景会共享。当前单窗口，可接受。 | 记录备忘。 |
| N9 | `frontend/src/lib/router.ts:9-12` `readHash` + `navigate:24` | 用户手输非法 hash（如 `#/foobar`）时 `readHash` 返回 `"test"` 但不回写 hash，地址栏仍显示 `#/foobar`，而 `navigate("test")` 时 `v !== readHash()` 判定 `"test" !== "test"` 为 false 不写入，导致 hash 永不规范化。功能不坏，但地址栏与实际 tab 不一致。 | 在 `readHash` 或 `useHashRoute` effect 中，当 hash 非法时用 `history.replaceState` 把 hash 规范化为 `#/test`，保持地址栏一致。 |
| N10 | `frontend/src/lib/theme.ts:11` | 模块顶层 `mql = window.matchMedia(...)` 在模块加载时即执行。纯客户端 SPA 无碍，但若将来引入 SSR/预渲染会在无 `window` 环境崩。当前无此场景。 | 记录备忘；若引入 SSR 再移入函数内。 |
| N11 | `frontend/src/index.css:27-71` | 浅色主题变量在 `:root[data-theme="light"]` 与 `@media (prefers-color-scheme: light) :root:not([data-theme="dark"])` 两处重复定义，修改时需同步两份。 | 可接受（显式覆盖策略）。若希望 DRY，可把浅色变量抽到一个共享选择器列表，但 CSS 变量重复在此规模可接受。 |
| N12 | `frontend/src/components/SettingsPanel.tsx:91-96` | 开机自启仍用原生 `<input type="checkbox">`，与项目其他表单控件（shadcn）风格不一致；新增的主题选择用了 button 但也非 shadcn SegmentedControl。 | 统一用 shadcn `Switch`（自启）与 `ToggleGroup`/`Tabs`（主题），保持 design system 一致。与 N3 合并处理。 |

## 准入结论

**结论**：`条件准入`

**说明**：核心架构与实现质量良好，无设计性错误。B1（winreg 顶层导入）虽当前 Windows 部署不触发，但直接违反"保留服务器部署能力"需求且修复成本极低，建议合并前处理。S1（跨线程 destroy）和 S2（uvicorn 无优雅退出）建议在首次实机验证时一并确认和修复，S4（无图标）影响托盘可见性，应在打包前补齐。前端新增 4 项（hash 路由、主题、设置面板、CSS 变量）实现正确无回归，建议修改项 S9/S10（主题监听清理、首帧闪屏）可在前端迭代中处理，N9-N12 为体验与一致性优化，可后续迭代。
