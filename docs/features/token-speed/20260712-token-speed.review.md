# 检视报告

## 概要

本次变更实现了服务商管理与测速的 UX 分离重构，以及 `batch/speed-test` API 改为接收 `tests: [{model, base_url, api_key}]` 结构以支持跨服务商同时测速。整体架构方向正确，前后端契约一致，组件拆分合理，但存在 2 个后端类型错误可能阻塞运行，另有若干细节需修正。

## 需求对齐

- ✅ UX 分离：sidebar 仅放 ConnectionConfig，主区域聚合 ModelSelector + SpeedTestForm — 与 `20260712-ux-separation.plan.md` 一致
- ✅ 跨服务商测速：`BatchSpeedTestRequest.tests` 改为 per-item `{model, base_url, api_key}` — 与 plan 一致
- ✅ 检测模型按钮移到管理对话框内，创建服务商时自动检测 — 已实现
- ✅ 移动端服务商面板可折叠（`lg:hidden` + `mobileOpen` state） — 已实现
- ✅ 前端 ModelSelector 按服务商分组展示，支持跨服务商多选 — 已实现
- ⚠️ `SpeedTestRequest`（单次测速 API）仍保留在后端但前端不再调用 — 不影响功能，合理保留
- ⚠️ plan 中"通过回调通知 App 模型变更"通过 `handleProvidersChange` 刷新整个 providers 列表实现 — 符合预期

## 阻塞问题

| ID  | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| B1  | `backend/main.py:92` — `asyncio.gather(...)` | 未设置 `return_exceptions=True`。若任意一次测速因网络异常抛出 Exception，整个 batch 立即失败，所有已完成的结果丢失。（注：后续代码中对 `r` 的 `isinstance(r, Exception)` 判断暗示期望处理异常，但 gather 未捕获） | 改为 `asyncio.gather(*[...], return_exceptions=True)` |
| B2  | `backend/main.py:126-128` | `results` 经 `asyncio.gather(return_exceptions=True)` 后类型为包含 `BaseException` 的联合类型，后续 `insert_speed_test(r)` 和 `SpeedTestResult(**r)` 的类型检查器报错：不能接受 `BaseException` 类型 | 在遍历 `results` 前显式过滤异常项：先分离 `exceptions = [r for r in results if isinstance(r, BaseException)]`，确保剩余均为 `dict` |

## 建议修改

| ID  | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| S1  | `frontend/src/components/ModelSelector.tsx:16` | 空状态文案："在左侧服务商点击 🔄 检测模型或手动添加" — 但卡片上的直接检测按钮已移除（仅管理对话框内有），文案指向不明确 | 改为"在左侧服务商点击列表图标管理模型，然后检测或手动添加" |
| S2  | `frontend/src/App.tsx:45` | `handleProvidersChange` 中用 `${p.id}\|${m}` 拼接 validKeys 做前缀匹配来清理已选模型。若 model 名本身含 `\|`，存在误匹配/误删的风险 | 使用 `JSON.stringify` 构造 key 或改用 `Map<string, {model, baseUrl, apiKey}>` + 逐 key 精确匹配。当前模型名不含 `\|`，低风险，记录为技术债 |
| S3  | `frontend/src/components/ConnectionConfig.tsx:82-92` | `handleSaveProvider` 创建成功后调用 `await refresh()` 两次（第 84 行创建后 refresh，第 89 行 detect 后再 refresh），存在一次冗余刷新 | detect 完成后只 refresh 一次；创建后先不 refresh，等 detect 完成统一刷新 |
| S4  | `frontend/src/components/ConnectionConfig.tsx:56-63` | `handleDetectModels` 闭包依赖 `managingProvider`，若检测过程中用户关闭管理对话框，闭包中 `managingProvider` 可能已过期（但 `setManagingProvider` 调用时检测已结束，问题不大） | 低风险。如需严谨，用 ref 持有当前管理 provider id |
| S5  | `backend/main.py:96-117` | batch endpoint 中 error 结果字典字段硬编码（如 `tps: 0`），与 `run_speed_test` 返回的正常结果结构分散在两处定义 | 将 error 结果构造抽取为 `make_error_result(exception)` 函数，复用字段结构 |
| S6  | `frontend/src/components/SpeedTestForm.tsx:79` | Streaming 模式 checkbox 无 tooltip 说明，用户可能不理解其对测速结果的影响（TTFT 更准确但 TPS 可能偏低） | 添加 `title` 属性简短说明 |
| S7  | `backend/main.py:43` | `list_models()` 返回 `tuple[bool, list[dict] \| str]`，在 `success=True` 时传给 `ConnectResponse(models=result)` 存在类型不安全（`result` 可能为 `str`） | 将 `list_models` 返回类型收紧为 `tuple[bool, list[dict]]`，或对 `result` 显式 cast |

## 非阻塞问题

| ID  | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| N1  | `frontend/src/App.tsx:163-178` | 移动端 ConnectionConfig 在 `<main>` 顶部渲染，与 sidebar 逻辑重复。provider 多时需滚动才到测速区 | 当前 `mobileOpen` 默认 `false`（折叠），体验可接受。后续可考虑移动端将 ConnectionConfig 改为底部 Sheet |
| N2  | `frontend/src/components/ModelSelector.tsx:36` | `Array.from(selected.keys()).filter()` 在每次渲染遍历所有 key — 模型 100+ 时有微小性能影响 | 可用 `useMemo` 缓存分组统计，非紧急 |
| N3  | `backend/main.py:25` | `/api/connect` 和 `/api/speed-test` 单次端点保留但前端不再调用 | 后续迭代可标记为 deprecated 或移除以减少维护面 |
| N4  | `frontend/src/components/SpeedTestResults.tsx:88` | `model.split("/").pop()` 模型名截取逻辑在多个文件重复 | 抽取 `shortModelName(model: string)` 到 `utils.ts` |

## 准入结论

**结论**：`条件准入`

**说明**：存在 2 个阻塞问题——B1 批量测速缺少 `return_exceptions=True` 导致单次失败拖垮全批次，B2 类型错误在严格类型检查下阻塞运行。建议修复后再合并。建议修改项 S1–S7 无阻塞性，可在后续迭代处理。
