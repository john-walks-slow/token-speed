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

## 统计看板（独立端口）与管理密码

应用默认仅绑定 `127.0.0.1`。可额外把**只读统计看板**（仅统计 + 历史，无任何管理功能，不暴露 API key）暴露到局域网：

| 环境变量 | 默认 | 说明 |
|---|---|---|
| `TOKEN_SPEED_DASHBOARD_HOST` | `0.0.0.0` | 看板绑定地址 |
| `TOKEN_SPEED_DASHBOARD_PORT` | `8855` | 看板端口 |
| `TOKEN_SPEED_DASHBOARD_DISABLED` | 空（启用） | 设 `1` 禁用看板 |
| `TOKEN_SPEED_ADMIN_PASSWORD` | 未设 | 管理密码；配置后主应用的管理功能（服务商/定时/设置）需密码，统计/历史免密 |
| `TOKEN_SPEED_ADMIN_PASSWORD`（桌面） | — | 也可用 `TokenSpeed.exe --admin-password X` / `--dashboard-port N` 传入 |

**启动方式**：

- **开发**：`start.bat` 起主应用（127.0.0.1:8000）；构建前端后 `python -m backend.server` 同时起主应用与看板（或用 `uvicorn backend.dashboard:app --host 0.0.0.0 --port 8855` 只起看板）。
- **服务器部署**：`python -m backend.server`（同进程双服务器，主应用 127.0.0.1:8000 + 看板 0.0.0.0:8855，配置走环境变量）。
- **桌面**：默认启动即起看板，托盘菜单「打开统计看板」直达。

手机/局域网浏览器访问 `http://<本机IP>:8855/` 查看只读统计看板。

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
  dashboard.py     # 独立端口只读统计看板 app
  security.py      # 管理密码中间件
  server.py        # 服务器部署入口（同进程双服务器）
  speed_test.py    # 测速核心（stream/non-stream，content 收集）
  scheduler.py     # 定时调度器
  database.py      # SQLite 访问 + schema 迁移
  rate_limit.py    # RPM 限流
  models.py        # Pydantic 模型
frontend/src/
  App.tsx          # 门控根组件（模式/登录判定）
  FullApp.tsx      # 主应用布局 + 状态编排
  DashboardApp.tsx # 只读统计看板
  components/      # 测速/结果/统计/定时/服务商管理
  lib/             # api 封装、modelLabel（provider 展示名）
website/           # 产品官网（静态站，GitHub Pages 发布）
```

## 数据库

`backend/speed_tests.db`（SQLite，首次连接自动建表/迁移）。`*.db` 已被 gitignore，不入版本库。

## 文档

功能开发记录见 `docs/features/`（plan / validation / review / summary）。
