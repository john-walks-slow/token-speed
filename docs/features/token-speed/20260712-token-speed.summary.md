# Token Speed 开发总结

> 日期: 2026-07-12
> 需求: LLM API 延迟与速度检测工具，WebUI，多服务商管理，跨服务商同/异步测速

## 最终架构

```
frontend (React 19 + Vite + Tailwind v4 + Recharts)
  └─ sidebar: 服务商管理（添加/编辑/删除/模型检测与管理，移动端可折叠）
  └─ main: 模型选择（按服务商分组）→ 测速参数 → 结果展示 + 历史 + 统计
backend (FastAPI + SQLite)
  └─ /api/connect — 检测模型（/v1/models）
  └─ /api/providers* — 服务商 CRUD + 模型缓存
  └─ /api/speed-test — 单次/批量测速（支持 streaming）
  └─ /api/history — 历史记录
  └─ /api/stats — 聚合统计
```

## 关键设计决策

### 1. UI 框架: Tailwind v4 + shadcn/ui 风格
- 选择了最近刚切换默认底层为 Base UI 的 shadcn/ui 风格
- 自己手写基础组件而非安装 shadcn/ui CLI（避免过多依赖）
- Tailwind v4 的 `@theme` 自定义深色主题

### 2. 服务商与测速分离
- 最终服务商管理放在 sidebar，模型选择和测速在主区域
- 支持跨服务商批量测速（后端 tests 数组）
- 模型检测结果缓存到 providers.models_json 字段，点击不刷新

### 3. 统计面板
- 基于调研报告的模型过滤 + 时间范围 + 指标切换
- 小多图 (Small Multiples) 处理多模型趋势场景
- 真时间轴（`type="number" scale="time"`）而非序号索引

### 4. 数据库
- 全局 `threading.local` + `check_same_thread=False` 实现线程安全
- `async` 函数但同步执行 SQLite（非高频场景可接受）

## 值得注意的问题

- pip 环境有权限问题（`en_core_web_sm` 拒绝访问），改用 `sqlite3` 替换 `aiosqlite`
- 使用 `replace_string_in_file` 多次出现内容重复（工具偶发），需注意清理
- reviewer 报告的 `return_exceptions=True` 缺漏已在早期版本修复

## 启动方式

```bash
# 后端
cd x:\Coding\token-speed
python -m uvicorn backend.main:app --reload --port 8000

# 前端
cd x:\Coding\token-speed\frontend
npm run dev
```
