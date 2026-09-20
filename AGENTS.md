# Token Speed AGENTS.md

## 目标

LLM API 延迟与速度检测工具：多服务商管理、跨模型批量测速、定时巡检、历史与统计可视化。
核心价值是**测速指标口径正确**（TTFT / TPS / 思考时长 / token 拆分，兼容不同网关的 usage 统计口径）。

## 地图

- `backend/main.py` — FastAPI 路由 + 前端静态挂载（`frontend/dist` 存在时）
- `backend/speed_test.py` — 测速核心：流式/非流式、OpenAI/Anthropic 协议、usage 口径统一（`_reconcile_token_counts`）。`execute_batch_tests` 通过 sink callback 解耦数据落地，本地 App 与巡检版共用
- `backend/scheduler.py` — 定时调度（事件循环内 30s 轮询），传 sqlite_sink
- `backend/database.py` — SQLite 访问 + schema 迁移（列追加式）
- `backend/paths.py` — frozen(exe)/开发态路径区分
- `backend/patrol_config.py` — 巡检配置数据结构（PatrolConfig，core 层契约，同构不同源）
- `backend/patrol_runner.py` — GH Actions 巡检入口（`python -m backend.patrol_runner`），产 JSONL 到 `website/patrol/data/`
- `frontend/src/App.tsx` — 布局 + 状态编排；`components/` 各面板
- `frontend/src/components/StatsPanel.tsx` — 统计聚合与图表（解析/输入双口径）
- `website/patrol/` — 巡检看板（`index.html` 零构建，`data/` 存 JSONL 结果），GitHub Pages 唯一内容
- `config/patrol.json.example` — 巡检配置示例（fork 后改名 patrol.json + 填 Secrets）
- `.github/workflows/deploy-website.yml` — Pages 部署（build_type=workflow）
- `.github/workflows/patrol.yml` — 巡检 cron（每6h，13分错开整点）+ 结果 commit
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

# 巡检看板本地预览
python -m http.server 8899 -d website

# 桌面版打包（Windows）
python build.py --zip
```

## 规范

- usage 口径有两种：completion_tokens 含 reasoning（OpenAI/DeepSeek）与不含（Gemini 系网关转发）。
  一切 token 计算必须经 `_reconcile_token_counts`，不要直接相减。
- 思考时长只在流中真实出现 reasoning 增量时可测；网关只转正文时 thinking_ms 必须为 None。
- 统计中失败样本（actual_model='error'）按输入 modelid 归组计入成功率；数值指标先过滤 success。
- `execute_batch_tests` 的数据落地由 sink callback 注入（逐条消费）。core 层不感知数据去向——本地 App 传 sqlite_sink，巡检 runner 传 json_sink。不要在 core 层加数据存储分支。
- 两套数据独立不合并：本地 SQLite 与巡检 JSONL 不加 source 列、不合并视图，各看各的入口。
- 前端改动后需 `npm run build` 才会反映到后端挂载的静态站。
- 巡检看板（`website/patrol/`）是零构建纯 JS，原生 Canvas 图表；改代码后无需构建，push 即生效（deploy-website 自动发布）。
