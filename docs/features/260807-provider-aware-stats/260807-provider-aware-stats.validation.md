# Provider 感知统计 + 回复内容记录 + 共用模型选择器 — 验证

> 日期: 2026-08-07

## 验证方式

- 自动化：`python -m pytest backend/test_scheduler.py`（11 passed，含新 provider 断言）
- 类型：`npx tsc -b`（project references 全绿）+ `npx vite build`
- DB 迁移与数据 round-trip 脚本验证：新列可写读、legacy 记录兼容
- 回复内容收集：mock httpx 验证 stream 拼接（含 reasoning 隔离）、non-stream 取值、错误分支 provider 保留

## 待用户实机确认

1. **provider 标签**：两个 provider 配同一 modelid（如都配 `gpt-4o`）→ 测速进度、结果页、历史均显示 `gpt-4o (ProviderA)` / `gpt-4o (ProviderB)`；单个 provider 的模型不带后缀。
2. **回复内容**：测速完成后 hover 各处的页面图标（FileText），能看到实际回复正文，超长内容可滚动。
3. **成功率图**：统计页新增「成功率（成功/全部）」横条图，bar 上显示 `rate% (成功/总数)`，随上方时间范围和模型筛选变化；含失败样本。
4. **共用选择器**：统计页模型选择器与测速页同构（按 provider 分组），选中徽标有色且颜色与折线/柱状一致。
5. **删除 provider 兜底**：删除某 provider 后，其历史记录仍显示 `model (快照名)` 而非丢失；统计页出现对应幽灵组。
