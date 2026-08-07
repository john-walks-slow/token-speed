# Provider 感知统计 + 回复内容记录 + 共用模型选择器 — 实施计划

> 日期: 2026-08-07
> 类型: 需求开发

## 背景

聚合统计存在三个设计缺陷：

1. **provider 同 modelid 被合并**。统计与所有图表只按 `model` 聚合，两个 provider 都有 gpt-4o 时结果混在一起。
2. **缺按 provider 的成功率**。所有图表过滤 `success`，后端 `tests_by_model` 直接 `WHERE success=1`，失败样本完全不可见。
3. **回复内容未保存**。测速完成后无法查看实际响应正文。

另：统计页有一排扁平模型徽标，与测速页按 provider 分组的 ModelSelector 重复。

## 需求

1. 凡展示模型名处（除测速页，它已按 provider 分组），若某 modelid 被 >1 provider 提供，显示 `model (provider名)`。
2. 新增横向 bar chart「成功率」，按 (provider, model) 对统计 `成功/全部`，bar 上直接写 `rate% (成功/总数)`，范围跟随时间+模型筛选。
3. 保存可见回复 content，进度/结果/历史通过 hover 图标查看。
4. 统计页复用 ModelSelector，选中徽标着色（颜色与折线/柱状单一来源）。

## 架构决策

- **记录带 provider 身份**：`speed_tests` 加 `provider_id` / `provider_name`(插入时快照) / `response_content` 三列。SQLite 迁移复用现有 `ALTER TABLE ... try/except` 循环。展示名解析：目录最新名 → 快照 → hostname → unknown。
- **歧义按目录判定**：某 model 在目录被 >1 provider 收录即视为 ambiguous。
- **成功率在前端算**：StatsPanel 已从 `getHistory` 取数据（含失败），`get_stats` 不动；加载量 200→500。
- **颜色单一来源**：有序 (provider,model) 对列表 → `pairColor(key)`，徽标/折线/柱状/成功率图共用。
- **ModelSelector 通用化**：接收 `groups: {id,name,models}[]` 而非 `Provider[]`；测速/统计/定时三处复用。

## 改动清单

### 后端
- `database.py`：迁移加 3 列；`insert_speed_test` 扩展。
- `models.py`：`BatchSpeedTestItem` 加 `provider_id/provider_name`；`SpeedTestResult/History` 加三个可选字段。
- `speed_test.py`：`run_speed_test` 收集 content（stream 拼 `delta.content`、non-stream 取 `choices[0].message.content`）+ 透传 provider；`execute_batch_tests`/`_batch_error_result` 透传。
- `main.py`：`_to_error_result`/`_iter_batch_results` 透传。
- `scheduler.py`：targets 组装带 provider 身份。
- `test_scheduler.py`：新断言。

### 前端
- `types.ts`：字段扩展；`lib/modelLabel.ts`（新）：provider 解析 + 展示名。
- `components/ModelSelector.tsx`：重构为通用 groups 版。
- `App.tsx`：key-based toggle + 传 providers。
- `components/ResponseContentView.tsx`（新）：hover 内容展示。
- `SpeedTestProgress/SpeedTestResults/HistoryList`：`modelDisplayLabel` + 内容图标。
- `StatsPanel.tsx`：按对分组 + 成功率图 + 复用 ModelSelector。

## 验证

- `pytest backend/test_scheduler.py`（11 passed）。
- `tsc -b`（真实 project references 检查）+ `vite build`。
- 手工 smoke：两 provider 同 modelid → 各页显示 `model (Provider)`；成功率图计入失败；删除 provider 后快照名兜底。
