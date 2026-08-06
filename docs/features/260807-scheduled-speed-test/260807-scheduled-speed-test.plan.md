# 定期测速功能计划

## 概述

为 Token Speed 添加定期测速能力：用户可创建定时任务，按指定间隔自动对选定服务商/模型执行批量测速，结果自动写入历史，统计面板的趋势图随之生效。

## 用户使用路径

1. 进入「定期测速」Tab（新增的第四个 Tab）
2. 点击「新建定时任务」，表单展开：
   - 填写任务名称、执行间隔（分钟）
   - 选择目标模型（复用 ModelSelector 的多选交互）
   - 配置测速参数（prompt、max_tokens、temperature、并发、迭代次数、stream）
3. 保存后任务立即生效，后端按间隔自动执行
4. 任务列表展示每个任务的状态（运行中/已暂停）、上次执行时间与结果、下次执行时间（绝对时间，如「下次 12:34」；运行中则显示「执行中」，不显示时间）
5. 操作：暂停/恢复、编辑、手动触发一次、删除
6. 每次自动执行的结果写入历史（带 schedule_id 标记）；历史列表中显示来源任务名小标签；统计面板自动纳入这些数据

## 架构设计

### 调度器（backend/scheduler.py，新文件）

不引入 APScheduler 等外部依赖，直接在 FastAPI 事件循环内跑 asyncio 后台任务：

```python
class SpeedTestScheduler:
    def __init__(self):
        self._task: asyncio.Task | None = None
        self._running_ids: set[str] = set()   # 防重入

    async def start(self): ...        # lifespan 启动时调用：恢复 next_run_at + 启动轮询
    async def stop(self): ...         # lifespan 关闭时优雅停止
    async def _poll(self): ...        # 每 30s 查一次到期任务
    async def _run_schedule(self, schedule_id: str): ...
```

- 轮询逻辑：查询 `enabled=1 AND next_run_at <= now` 的 schedule，每个到期任务派发独立 asyncio task
- **防重入**：`_running_ids` 记录执行中的 schedule，重复触发直接跳过
- **执行流程**：解析 targets → 按 provider_id 实时查 providers 表拿最新 base_url/api_key → 组装 tests 列表 → 复用批量测速逻辑 → 结果写 speed_tests（带 schedule_id）→ 更新 last_run_at / next_run_at / last_run_status
- **next_run_at 推进**：完成时统一 `next_run_at = now + interval`（不按 `last_run_at + interval`。短间隔任务执行时长可能超过间隔，按旧公式会完成后立即再触发，形成忙循环、下次执行时间恒为 0）
- **provider 已删除**：跳过该 target；全部 target 失效则本次标记 failed
- **启动恢复**：start() 时把所有 enabled 任务的过期 next_run_at 重置为 `now + interval`（不补跑错过的轮次）；同时把遗留的 `running` 状态重置为 `failed`（上次进程被杀未收尾，避免前端永久显示「运行中」）
- **手动触发**不影响 next_run_at

### 数据库变更（backend/database.py）

新增 `schedules` 表：

```sql
CREATE TABLE IF NOT EXISTS schedules (
    id               TEXT PRIMARY KEY,
    name             TEXT NOT NULL,
    enabled          INTEGER DEFAULT 1,
    interval_minutes INTEGER NOT NULL,
    prompt           TEXT,
    max_tokens       INTEGER DEFAULT 128,
    temperature      REAL DEFAULT 0.7,
    stream           INTEGER DEFAULT 1,
    concurrency      INTEGER DEFAULT 1,
    iterations       INTEGER DEFAULT 1,
    targets_json     TEXT DEFAULT '[]',
    created_at       TIMESTAMP,
    updated_at       TIMESTAMP,
    last_run_at      TIMESTAMP,
    next_run_at      TIMESTAMP,
    last_run_status  TEXT
)
```

- `targets_json`：`[{"provider_id": "...", "models": ["m1", "m2"]}]`，显式存模型列表（不搞"空=全部"的隐式语义）
- `speed_tests` 表 ALTER 新增 `schedule_id TEXT` 列（沿用现有 try/except 迁移模式）
- `insert_speed_test(result, schedule_id=None)` 增加可选参数
- `last_run_status` 取值：success / partial / failed / running
- 新增 CRUD：list_schedules、get_schedule、create_schedule、update_schedule、delete_schedule、get_due_schedules、update_schedule_run_status

### 后端 API（backend/main.py）

```
GET    /api/schedules              列出所有定时任务
POST   /api/schedules              创建（返回完整 ScheduleResponse，含 next_run_at）
PUT    /api/schedules/{id}         编辑（重置 next_run_at = now + interval）
DELETE /api/schedules/{id}         删除
PUT    /api/schedules/{id}/toggle  启用/暂停切换
POST   /api/schedules/{id}/run     手动触发一次（执行中则返回 409）
```

**批量测速逻辑抽取**：现有 `batch_speed_test` 端点内联的任务构建 + semaphore + gather + 入库逻辑抽成共享函数：

```python
async def execute_batch_tests(
    tests: list[BatchSpeedTestItem],
    prompt, max_tokens, temperature, stream,
    concurrency, iterations,
    schedule_id: str | None = None,
) -> list[dict]
```

batch 端点与 scheduler 共用此函数；batch 端点继续负责 summary 计算。

**lifespan**：app 改为 `FastAPI(lifespan=lifespan)`，启动时 `scheduler.start()`，关闭时 `scheduler.stop()`。

### Pydantic 模型（backend/models.py）

- `ScheduleTarget`：`{provider_id: str, models: list[str]}`
- `ScheduleCreate`：name, interval_minutes, targets, prompt, max_tokens, temperature, stream, concurrency, iterations
- `ScheduleUpdate`：同上全部可选
- `ScheduleResponse`：完整字段（含 enabled, last_run_at, next_run_at, last_run_status, created_at, updated_at）
- `SpeedTestHistory` 增加 `schedule_id: Optional[str] = None`

### 前端变更

- **types.ts**：`Schedule`、`ScheduleTarget` 类型；`TestHistory` 加 `schedule_id?: string | null`
- **lib/api.ts**：getSchedules / createSchedule / updateSchedule / deleteSchedule / toggleSchedule / runScheduleNow
- **components/TestParamsFields.tsx**（新）：**受控组件**，props 为 `values: TestParamsValues; onChange: (v) => void`，state 由调用方持有。字段：prompt、max_tokens、temperature、concurrency、iterations、stream。SpeedTestForm 与 ScheduleForm 复用同一参数输入组，避免字段重复维护
- **components/ScheduleForm.tsx**（新）：名称 + 间隔输入（提供快捷项 5/15/30/60/120）+ 复用 ModelSelector 选模型（内部维护 `Map<string, SpeedTestItem>`，提交时按 provider 分组转 targets）+ `<TestParamsFields>`。创建与编辑复用同一组件：编辑时传初始 schedule、从 targets_json 重建 Map。**重建时若 target 引用的 provider/模型已删除会被静默丢弃，需在表单给出提示**（后端执行时实时解析 targets，功能不受影响，仅编辑 UX 需留意）
- **components/ScheduleList.tsx**（新）：任务卡片列表，展示名称、间隔、状态 Badge、上次执行（时间 + 结果）、下次执行时间（**绝对时间**，不做秒级倒计时）；操作按钮：暂停/恢复、立即执行、编辑、删除。**自持 30s 轮询**（对齐调度器 30s tick，不额外做 15s），useEffect 内 setInterval + 清理函数、skip-if-pending 防重叠、失败静默（与 HistoryList/StatsPanel 模式一致）。**「立即执行」在 `status==running` 时禁用**，catch 409 显示内联错误（全站无 toast）
- **App.tsx**：Tabs 增加第四个 Tab（grid-cols-3 → grid-cols-4；**标签用「定时」而非「定期测速」，避免移动端 360px 下 4 列溢出**）；schedules 状态与 providers 一样在 App 层加载（ScheduleForm 需要 providers 数据）
- **HistoryList.tsx**：加载 schedules 列表建立 id→name 映射，有 schedule_id 的记录显示任务名小 Badge（任务已删除则显示「定时」）。「结果」「统计」页**切 Tab 时刷新即可**（现有 TabsContent 非激活即卸载重取，无需额外联动刷新）

## 实现顺序

1. backend/database.py — schedules 表 + schedule_id 列迁移 + CRUD 函数
2. backend/models.py — Pydantic 模型
3. backend/main.py — execute_batch_tests 抽取 + lifespan + 6 个端点
4. backend/scheduler.py — 调度器
5. frontend/types.ts + lib/api.ts
6. frontend/components/TestParamsFields.tsx + SpeedTestForm 改造（受控组件；汇总行「N 模型 × M 次」保留在 SpeedTestForm 自身）
7. frontend/components/ScheduleForm.tsx
8. frontend/components/ScheduleList.tsx
9. frontend/App.tsx — Tab 集成
10. frontend/HistoryList.tsx — 定时标记
11. backend/test_scheduler.py — 调度核心逻辑单测（到期判定、next_run_at 计算、targets 解析、防重入）；需新增 pytest 依赖
12. 手动验证：创建任务 → 等待自动执行 → 历史/统计可见 → 暂停/恢复/手动触发/编辑/删除 → 重启后端验证恢复逻辑

## 验证清单

- [ ] 创建 1 分钟间隔任务，约 1 分钟后历史出现新记录（带定时标记）
- [ ] 统计面板趋势图包含定时数据
- [ ] 暂停后不再执行，恢复后继续
- [ ] 手动触发立即执行且不打乱下次计划
- [ ] 执行中重复触发被拒绝（409）
- [ ] 删除任务后历史记录的 Badge 降级为「定时」
- [ ] 重启后端：过期任务重置 next_run_at 而非补跑；遗留 running 状态不再显示「运行中」
- [ ] 短间隔任务执行时长超过间隔时不形成忙循环（下次执行时间按 now + interval 正常推进）
- [ ] 运行中任务隐藏下次执行时间、显示「执行中」，且「立即执行」按钮禁用
- [ ] 编辑 provider 的 api_key 后定时任务使用新 key

