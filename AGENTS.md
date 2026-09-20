# Token Speed AGENTS.md

## 目标

LLM API 延迟与速度检测工具（桌面版）：多服务商管理、跨模型批量测速、定时测速、历史与统计可视化。
核心价值是**测速指标口径正确**（TTFT / TPS / 思考时长 / token 拆分，兼容不同网关的 usage 统计口径）。

免服务器巡检版已拆分至 [token-speed-patrol](https://github.com/john-walks-slow/token-speed-patrol)，
两仓库共用测速内核：`speed_test.py` / `rate_limit.py` / `url_utils.py` 纯拷贝同源，
**改动需手动同步另一仓库**。

## 地图

- `backend/main.py` — FastAPI 路由 + 前端静态挂载（`frontend/dist` 存在时）；adapter 层，注入 client_kwargs
- `backend/speed_test.py` — 测速核心：流式/非流式、OpenAI/Anthropic 协议、usage 口径统一（`_reconcile_token_counts`）。core 层无存储/设置依赖，client_kwargs 由调用方注入
- `backend/scheduler.py` — 定时调度（事件循环内 30s 轮询），传 sqlite_sink + client_kwargs
- `backend/database.py` — SQLite 访问 + schema 迁移（列追加式）
- `backend/paths.py` — frozen(exe)/开发态路径区分
- `frontend/src/App.tsx` — 布局 + 状态编排；`components/` 各面板
- `frontend/src/components/StatsPanel.tsx` — 统计聚合与图表（解析/输入双口径）
- `build.py` — 桌面版构建：前端构建 + PyInstaller 打包（--zip 产出发布 zip）
- `.github/workflows/release.yml` — tag `v*` 触发 Windows 打包并附到 GitHub Release

## 开发与调试

```bash
# 后端测试（必须全绿）
python -m pytest backend/ -q

# 本地跑（前端构建后单进程）
cd frontend && npm install && npm run build && cd ..
python -m uvicorn backend.main:app --port 8000   # http://localhost:8000

# 前端 dev 模式（vite 5173 代理 /api → 8000）
cd frontend && npm run dev

# 桌面版打包（Windows）
python build.py --zip
```

## 规范

- usage 口径有两种：completion_tokens 含 reasoning（OpenAI/DeepSeek）与不含（Gemini 系网关转发）。
  一切 token 计算必须经 `_reconcile_token_counts`，不要直接相减。
- 思考时长只在流中真实出现 reasoning 增量时可测；网关只转正文时 thinking_ms 必须为 None。
- 统计中失败样本（actual_model='error'）按输入 modelid 归组计入成功率；数值指标先过滤 success。
- core 层（speed_test/rate_limit/url_utils）不依赖 database/network_settings；代理、TLS 等
  网络参数由 adapter 层（main/scheduler）以 client_kwargs 注入。不要在 core 层加数据存储或设置读取分支。
- 前端改动后需 `npm run build` 才会反映到后端挂载的静态站。
