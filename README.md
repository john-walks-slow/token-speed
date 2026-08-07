# Token Speed

LLM API 延迟与速度检测工具。多服务商管理、跨服务商批量测速、定时测速、历史与统计可视化。

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

## 目录结构

```
backend/
  main.py          # FastAPI 路由
  speed_test.py    # 测速核心（stream/non-stream，content 收集）
  scheduler.py     # 定时调度器
  database.py      # SQLite 访问 + schema 迁移
  rate_limit.py    # RPM 限流
  models.py        # Pydantic 模型
frontend/src/
  App.tsx          # 布局 + 状态编排
  components/      # 测速/结果/统计/定时/服务商管理
  lib/             # api 封装、modelLabel（provider 展示名）
```

## 数据库

`backend/speed_tests.db`（SQLite，首次连接自动建表/迁移）。`*.db` 已被 gitignore，不入版本库。

## 文档

功能开发记录见 `docs/features/`（plan / validation / review / summary）。
