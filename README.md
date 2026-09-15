# Token Speed

LLM API 延迟与速度检测工具。多服务商管理、跨服务商批量测速、定时测速、历史与统计可视化。

**官网**：<https://john-walks-slow.github.io/token-speed/>

## 功能

- **多服务商管理**：添加/编辑/删除服务商，检测并缓存模型列表。
- **批量测速**：跨服务商、多模型选择，支持流式/非流式，并发 + 迭代控制，SSE 实时进度、可中途取消。
- **Provider 感知统计**：统计、结果、历史按 (provider, model) 对聚合——多个 provider 提供同一 modelid 时分开展示为 `model (provider名)`。
- **成功率统计**：横向 bar chart 按 (provider, model) 统计 `成功/全部`，bar 上显示 `rate% (成功/总数)`，范围跟随时间与模型筛选。
- **回复内容查看**：每次测速保存实际回复正文，进度/结果/历史 hover 图标即可查看。
- **定时测速**：按间隔自动执行，支持运行时参数（并发、迭代、关闭推理、RPM 限流）。
- **历史与统计**：时间序列趋势（小多图/单图）、模型对比、成功率、TTFT/延迟/TPS 指标切换。

## 技术栈

- **前端**：React 19 + TypeScript + Vite + Tailwind v4 + Recharts，shadcn/ui 风格组件。
- **后端**：FastAPI + SQLite（`sqlite3` 线程安全）+ httpx，SSE 流式推送，asyncio 调度器。

## 启动

开发模式（或直接运行根目录 `start.bat`）：

```bash
# 后端（端口 8000）
python -m uvicorn backend.main:app --reload --port 8000

# 前端（端口 5173，vite 代理 /api → 8000）
cd frontend
npm install
npm run dev
```

打开 http://localhost:5173。

## 管理密码（单端口只读 + 登录）

应用默认仅绑定 `127.0.0.1`，未配置密码时全功能即可用（向后兼容）。配置管理密码后，主端口未登录时直接展示**只读统计视图**（统计 + 历史，无任何管理功能，不暴露 API key）；登录后进入完整管理界面。

| 环境变量 | 默认 | 说明 |
|---|---|---|
| `TOKEN_SPEED_ADMIN_PASSWORD` | 未设 | 管理密码；配置后管理功能（服务商/定时/设置/删除等）需登录，统计/历史/只读视图免密 |
| `TOKEN_SPEED_ADMIN_PASSWORD`（桌面） | — | 也可用 `TokenSpeed.exe --admin-password X` 传入 |

**启动方式**：

- **开发**：`start.bat` 起主应用（127.0.0.1:8000）。
- **服务器部署**：单个 `uvicorn backend.main:app`（主应用 127.0.0.1:8000，配置走环境变量）。
- **桌面**：窗口自动注入 `admin_password` 直达完整界面；若手动访问，未登录显示只读视图、右上角「管理登录」。

手机/局域网浏览器访问 `http://<本机IP>:8000/` 默认看到只读统计视图（管理接口仍需登录）。

## Linux 服务器常驻部署

前端构建后单进程（supervisord 示例）：

```bash
cd frontend && npm install && npm run build && cd ..
python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
# 打开 http://127.0.0.1:8000（后端自动挂载 frontend/dist）
```

```ini
[program:token-speed]
command=/path/to/token-speed/.venv/bin/python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
directory=/path/to/token-speed
autostart=true
autorestart=true
```

## 官网

产品官网源码在 `website/`（纯静态、零构建依赖），master 分支推送后由
GitHub Actions 自动发布到 GitHub Pages。本地预览：`python -m http.server 8899 -d website`。

## 目录结构

```
backend/
  main.py          # FastAPI 主应用路由（read_router 只读 / admin_router 管理）
  security.py      # 管理密码中间件
  speed_test.py    # 测速核心（stream/non-stream，content 收集）
  scheduler.py     # 定时调度器
  database.py      # SQLite 访问 + schema 迁移
  rate_limit.py    # RPM 限流
  models.py        # Pydantic 模型
frontend/src/
  App.tsx          # 门控根组件（登录判定：匿名只读 / 登录管理）
  FullApp.tsx      # 主应用布局 + 状态编排
  DashboardApp.tsx # 只读统计视图（未登录默认）
  components/      # 测速/结果/统计/定时/服务商管理
  lib/             # api 封装、modelLabel（provider 展示名）
website/           # 产品官网（静态站，GitHub Pages 发布）
```

## 数据库

`backend/speed_tests.db`（SQLite，首次连接自动建表/迁移）。`*.db` 已被 gitignore，不入版本库。

## 文档

功能开发记录见 `docs/features/`（plan / validation / review / summary）。
