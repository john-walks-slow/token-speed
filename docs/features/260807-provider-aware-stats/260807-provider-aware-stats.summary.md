# Provider 感知统计 + 回复内容记录 + 共用模型选择器 — 开发总结

> 日期: 2026-08-07
> 需求: 修复 provider 同 modelid 聚合混淆、补充成功率统计、保存回复内容、统计页复用模型选择器

## 成果

### 1. Provider 感知的聚合与展示
- `speed_tests` 新增 `provider_id` / `provider_name`（插入时快照）/ `response_content` 三列，SQLite 迁移沿用 `ALTER TABLE` try/except 循环，旧库自动补 NULL。
- 展示名解析链：目录最新名 → 快照名 → base_url hostname → "unknown"。legacy 记录（无 provider_id）经 hostname 分组兜底。
- 仅当某 modelid 被当前目录 >1 provider 收录时显示 `model (provider名)`，否则纯 model 名。

### 2. 成功率统计
- 前端新增横向 bar chart「成功率」，按 (provider, model) 对统计 `成功/全部`，bar 上直接显示 `rate% (成功/总数)`（样本量一眼可见）。
- 统计范围跟随时间范围 + 模型选择器筛选。
- 时间序列/对比图同步按 (provider, model) 对分组（修复 provider 合并）。

### 3. 回复内容记录
- `run_speed_test`：stream 分支拼接 `delta.content`（reasoning 不保存），non-stream 取 `choices[0].message.content`；失败兜底 None。
- 进度/结果/历史通过 `ResponseContentView` hover 图标查看，空内容不渲染。

### 4. 共用 ModelSelector
- 重构为通用 `groups/selectedKeys/onToggle/onToggleAll/colorSelected/title` 版，测速、统计、定时三处复用。
- 统计页选中徽标按 pair 着色，颜色与折线/柱状单一来源（`pairColor`）。

## 关键决策
- 成功率在前端聚合（StatsPanel 已含失败样本），`get_stats` 后端不改。
- ModelSelector 参数从 `Provider[]` 泛化为 `groups`，统计页对已删除 provider 记录补「幽灵组」。

## 交付过程发现并修复
- 并行改动使部分文件（ScheduleForm 等）仍用旧 ModelSelector 接口，`tsc -b`（而非 `tsc --noEmit` 空检查）暴露编译失败；已迁移。
- lucide-react@0.475.0 上游缺根入口 `.d.ts`（`package.json types` 指向不存在文件），补本地 `src/lucide-react.d.ts` 声明。
- vite.config.ts 缺 `@types/node`；安装。
- StatsPanel TTFT 指标对 non-stream 为 null，绘图前过滤。
- `*.tsbuildinfo`、`.claude/` 加 gitignore。

## 已知限制
- 统计依赖 `getHistory(500)`，超过 500 条静默截断（S2）；列表接口返回全量 response_content，长回复时 payload 偏重（S1）。
- 歧义按当前目录判定，幽灵组模型不参与歧义计数。
