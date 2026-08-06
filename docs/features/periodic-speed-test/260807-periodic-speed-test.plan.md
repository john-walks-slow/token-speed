# 定期测速功能 — 实施计划

## 需求理解

用户希望 Token Speed 支持自动定期执行测速，无需手动触发。核心价值：将一次性测速工具升级为持续性能监控工具，跟踪 LLM API 服务商在不同时段的性能波动。

## 用户路径

1. **创建定时任务**：用户在"定时"标签页选择要测试的模型（复用现有 ModelSelector）、设置间隔（分钟）、配置测试参数，创建定时任务
2. **管理定时任务**：查看任务列表，启停/编辑/删除任务，查看下次执行时间
3. **查看定期结果**：定期测速结果自动写入 history，在统计面板中自然展示趋势；带 schedule 标记区分手动/定期来源

## 技术架构

### 调度方案：APScheduler

选择 APScheduler (AsyncIOScheduler)，理由：
- Python 定时任务的标准方案，社区成熟
- 原生支持 asyncio，与 FastAPI 无缝集成
- 支持 interval trigger，满足定期执行需求
- 内嵌运行，无需额外进程/服务

集成方式：在 FastAPI lifespan 中启动 scheduler，从数据库加载已启用的 schedules 注册为 jobs。

### 数据模型

#### 新增 schedules 表

```sql
CREATE TABLE schedules (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL DEFAULT '',
    tests_json      TEXT NOT NULL,
    prompt          TEXT DEFAULT 'Hello, tell me a short story in 3 sentences.',
    max_tokens      INTEGER DEFAULT 128,
    temperature     REAL DEFAULT 0.7,
    stream          INTEGER DEFAULT 1,
    concurrency     INTEGER DEFAULT 1,
    interval_minutes INTEGER NOT NULL,
    enabled         INTEGER DEFAULT 1,
    last_run_at     TEXT,
    last_status     TEXT DEFAULT '',
    created_at      TEXT DEFAULT (datetime('now')),
    updated_at      TEXT DEFAULT (datetime('now'))
);
```

tests_json 格式：`[{model, base_url, api_key}]`（复用 BatchSpeedTestItem 结构）

#### speed_tests 表新增列

```sql
ALTER TABLE speed_tests ADD COLUMN schedule_id TEXT DEFAULT '';
```

用于标记该条结果来自哪个定时任务（空字符串 = 手动触发）。

### API 设计

```
GET    /api/schedules            - 获取所有定时任务列表
POST   /api/schedules            - 创建定时任务
PUT    /api/schedules/{id}       - 更新定时任务
DELETE /api/schedules/{id}       - 删除定时任务
POST   /api/schedules/{id}/toggle - 启用/停用
POST   /api/schedules/{id}/run    - 立即执行一次（不影响定时周期）
```

### 前端 UI

在现有 Tabs 中新增"定时"标签页（位于"测速"和"结果"之间），内容：

**定时任务列表**：
- 每条显示：名称、测试模型摘要、间隔、状态（启用/停用）、上次执行时间和结果、下次执行倒计时
- 操作：启停 toggle、编辑、删除、立即执行

**创建/编辑表单**：
- 任务名称（可选）
- 模型选择（复用 ModelSelector 组件逻辑，按服务商分组展示 checkbox）
- 间隔设置（分钟数，提供快捷选项：5/15/30/60/120）
- 测试参数（prompt、max_tokens、temperature、stream，默认值与手动测速一致）

### 执行逻辑

```python
async def execute_schedule(schedule_id: str):
    # 1. 从 DB 读取 schedule 配置
    # 2. 遍历 tests_json，调用现有 run_speed_test()
    # 3. 结果写入 speed_tests 表（带 schedule_id 标记）
    # 4. 更新 schedule 的 last_run_at 和 last_status
```

执行时复用现有 `run_speed_test` + `insert_speed_test`，不重复造轮子。

### 前端结果区分

- HistoryList 中，来自定时任务的结果显示一个小的时钟/日历图标标记
- StatsPanel 无需改动 — 数据自然流入，时间序列趋势图自动展示定期测速的周期性数据点

## 实施步骤

### Step 1: 后端 — 数据库层
- `database.py`: 新增 schedules 表创建、CRUD 函数
- `database.py`: speed_tests 表 migration 添加 schedule_id 列
- `database.py`: insert_speed_test 支持 schedule_id 参数

### Step 2: 后端 — 模型与调度器
- `models.py`: 新增 Schedule 相关 Pydantic models
- 新建 `scheduler.py`: APScheduler 集成，schedule 执行逻辑
- `main.py`: lifespan 中启动/停止 scheduler，加载已有 schedules

### Step 3: 后端 — API 端点
- `main.py`: 新增 schedule CRUD + toggle + run 端点

### Step 4: 前端 — 类型与 API
- `types.ts`: 新增 Schedule 类型定义
- `api.ts`: 新增 schedule 相关 API 函数

### Step 5: 前端 — 定时任务页面
- 新建 `SchedulePanel.tsx`: 任务列表 + 创建/编辑表单
- `App.tsx`: 新增"定时"Tab

### Step 6: 前端 — 结果标记
- `HistoryList.tsx`: 定期结果加标记图标
- `types.ts`: TestHistory 增加 schedule_id 字段

## 依赖新增

```
# requirements.txt
apscheduler>=3.10.0,<4.0.0
```

## 文件影响清单

| 文件 | 操作 |
|------|------|
| backend/requirements.txt | 新增 apscheduler |
| backend/database.py | 修改（schedules 表 + migration） |
| backend/models.py | 修改（新增 Schedule models） |
| backend/scheduler.py | **新建** |
| backend/main.py | 修改（lifespan + schedule endpoints） |
| frontend/src/types.ts | 修改（Schedule 类型） |
| frontend/src/lib/api.ts | 修改（schedule API） |
| frontend/src/components/SchedulePanel.tsx | **新建** |
| frontend/src/components/HistoryList.tsx | 修改（schedule 标记） |
| frontend/src/App.tsx | 修改（新增 Tab） |

