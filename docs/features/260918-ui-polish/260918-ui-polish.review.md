# 检视报告

## 概要

检视 260918-ui-polish 五项 UI 改进（工作区未提交改动，涉及 ConnectionConfig.tsx / ModelSelector.tsx / StatsPanel.tsx / 新文件 lib/chartColors.ts）。五项需求均已按描述实现，整体质量良好：颜色工具抽到 lib/chartColors.ts 消除了重复、检测模型的勾选确认流程状态管理正确、ElidedTick 的像素估算方案合理。无阻塞问题，存在若干建议修改项。

## 需求对齐

- 改动 1（卡片去绿）：`border-primary/25 bg-primary/[0.03]`，两处（添加/编辑）均已替换，Card 基类自带 `border`，无丢失边框。符合。
- 改动 2（协议类型移位）：Badge chip 已删除，移入 base_url 行以 ` · ` 分隔。符合，但见 S2 截断问题。
- 改动 3（检测模型勾选确认）：detectedList/detectedChecked state、全选/反选、已有默认不勾/新模型默认勾并标「新」、`handleConfirmDetected` 合并后清空，均实现。符合。
- 改动 4（tick 按像素截断）：ElidedTick 改为 maxWidth 像素估算（中文 11px / 半角 6.6px），水平柱状图用 ResizeObserver 测容器宽 / 柱数 × 0.8，垂直布局 Y 轴固定 132px。符合，见 S4 测量口径偏差。
- 改动 5（chip 文字自适应）：`inkColorOn` 按 oklch L > 0.65 选黑/白；MODEL_COLORS/getModelColor 迁至 lib/chartColors.ts。对 8 个现有颜色逐一验证阈值划分均合理（green/amber/cyan/yellow→黑字，blue/purple/slate/red→白字）。符合。

## 阻塞问题

无。

## 建议修改

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| S1 | frontend/src/components/ConnectionConfig.tsx:318-320 | 描述行 `truncate` 加在整个 div 上，base_url 较长时协议类型（` · OpenAI 兼容`）会被截断掉，改动 2 的信息在长 URL 场景下实际不可见 | 改为 flex 布局：`<span className="truncate">{p.base_url}</span>` + `<span className="shrink-0"> · {protocol}</span>`，让 base_url 单独截断、协议文字始终可见 |
| S2 | frontend/src/components/ConnectionConfig.tsx:83-102 | 重新检测时未先清空上一次的 detectedList：若本次检测失败（res.success=false 或网络异常静默 catch），界面仍显示上一次的检测结果，用户可能误以为是本次结果并确认添加 | 在 `setDetecting(true)` 后立即 `setDetectedList([])`；失败时给出轻量提示（与全局「异常只提示不降级」原则一致） |
| S3 | frontend/src/components/ConnectionConfig.tsx:134-137 | 新建服务商保存后仍走旧逻辑：自动检测并**无确认直接全量写入** models，与本次改动的「检测→勾选→确认」交互模型不一致 | 与用户确认预期：要么新建后也走勾选确认流程（打开管理对话框并填充 detectedList），要么明确保留自动填充并在提交信息中记录这是有意为之 |
| S4 | frontend/src/components/StatsPanel.tsx:666-668 | comparisonRef 放在包裹 CardContent 的外层 div 上，测得宽度含 CardContent `p-4` 的 32px padding 及图表内部 margin，band 宽估算偏大 → 柱数多时 tick 仍可能轻微重叠 | 把 ref 移到 CardContent 上（或从测量值中减去 32px），使测量口径与绘图区一致 |
| S5 | frontend/src/lib/chartColors.ts:19-22 | `inkColorOn` 对非 oklch 字符串解析得 NaN，静默回退白字，若未来背景色来源变化（如用户自定义色）会产生不可读文字且无报错 | 由于当前调用方只会传 MODEL_COLORS 的 oklch 值，至少在注释中写明该前提；或在解析失败时回退深色墨水并加一句说明 |

## 非阻塞问题

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| N1 | frontend/src/components/StatsPanel.tsx:46-76 | ElidedTick 对 surrogate pair（emoji 等）按两个宽字符计，估算偏保守；`‥` 本身宽度未计入（靠 `cut - 1` 补偿）。均为近似，实际效果可接受 | 记录备忘即可，无需改动 |
| N2 | frontend/src/components/StatsPanel.tsx:686-713 | CardContent 被 div 包裹后内部 JSX 缩进未同步调整，块内缩进层级与实际嵌套不符，影响可读性 | 顺手对齐缩进 |
| N3 | frontend/src/components/StatsPanel.tsx:211-213 | 首帧 comparisonWidth=0 → barMaxWidth 回退 32px，理论上存在一帧过度截断；ResizeObserver 首次回调通常在绘制前触发，实际大概率不可见 | 如实测有闪烁，可将初始值设为 80（与空数据回退一致） |

## 准入结论

**结论**：`条件准入`

**说明**：五项需求全部按描述落地，无阻塞问题；S1（协议类型被截断不可见）与 S3（新建服务商交互不一致）直接影响本次两项改动的实际体验，建议合并前处理，其余可后续迭代。

---

# 检视报告（第二轮）

## 概要

复核第一轮 5 项检视意见的修复情况（ConnectionConfig.tsx / ModelSelector.tsx / StatsPanel.tsx / lib/chartColors.ts，工作区未提交改动）。S1、S2（部分）、S5 修复到位；但 S4 的修复存在关键缺陷：ResizeObserver 挂载时机错误导致宽度测量**从未生效**，改动 4 的核心逻辑实际未运行，且副作用使 tick 截断比旧版更狠。S3 经权衡有意保留，已记录。

## 修复项核对

| 项 | 结论 |
| --- | ---- |
| S1（协议文字可见性） | 已修复。base_url 单独 `truncate`、协议文字 `shrink-0`，长 URL 下协议类型始终可见（ConnectionConfig.tsx:324-327）。flex 子项带 `overflow:hidden` 时 `min-width:auto` 解析为 0，截断生效，写法正确 |
| S2（检测状态清空/失败提示） | 部分修复。开头已清空 detectedList/detectedChecked，失败路径有 detectError 提示，openManage 也会重置。**但成功路径未清空 detectError**，见 S2' |
| S3（新建自动填充） | 经需求权衡有意保留，交互不一致问题已知悉并接受，不再列为问题 |
| S4/N2（测量口径/缩进） | N2 缩进已对齐；S4 的 ref 迁移本身正确，但引入新的挂载时机缺陷，见 B1 |
| S5（inkColorOn 前提注释） | 已修复，注释写明仅支持本文件 oklch 色值、失败回退白字（chartColors.ts:18-19） |

## 阻塞问题

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| B1 | frontend/src/components/StatsPanel.tsx:206-214（结合 532-538 早返回、666 ref 挂载点） | ResizeObserver 的 useEffect 依赖为 `[]`，只在首次 commit 后执行一次；而组件初始 `loading=true`，首次 commit 渲染的是 spinner 早返回分支，此时 `comparisonRef.current` 为 null，effect 直接 return，**observer 从未挂载**。之后 loading 变 false、CardContent 渲染出来，effect 不会再执行。结果 `comparisonWidth` 恒为 0，`barMaxWidth` 恒落到 `Math.max(32, 负数) = 32`：改动 4 的像素估算从未生效，且 32px（约 4-5 个半角字符）比旧版 maxChars=9（约 7 字符 + ‥）截断更狠，属可见的功能回归 | 改用受控元素挂载：`const [el, setEl] = useState<HTMLDivElement \| null>(null)`，effect 依赖 `[el]`，`<CardContent ref={setEl}>`；ref 回调在元素实际出现（含晚挂载/重挂载）时触发，observer 才能正确 observe |

## 建议修改

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| S1' | frontend/src/components/ConnectionConfig.tsx:86-88 | handleDetectModels 开头清空了 detectedList/detectedChecked，但**未清空 detectError**：首次检测失败显示错误 → 重试成功 → 错误提示仍停留在检测结果上方，用户会误以为本次检测也出了问题 | 在 `setDetecting(true)` 后一并 `setDetectError("")`，一行修复 |
| S2' | frontend/src/components/ConnectionConfig.tsx:91-96 | 检测成功但返回 0 个模型时无任何反馈：spinner 停止后界面无变化（detectedList 为空不渲染区块，detectError 为空），用户不知道检测到底成功没有 | `res.success && ids.length === 0` 时给一条提示，如「连接成功，但未检测到模型」 |

## 非阻塞问题

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| N1 | frontend/src/components/StatsPanel.tsx:475-476 | 注释称「容器宽（扣除 CardContent p-4 的 32px padding）」，但 `e.contentRect.width` 本就是 content box（padding 已扣除），`- 32` 属重复扣减。恰好方向保守、且左侧 YAxis 也占宽，净效果可接受，但注释与实际口径不符 | 修正注释；若要精确，改为扣 YAxis 估算宽度而非 padding |
| N2 | frontend/src/components/StatsPanel.tsx:479 | `Math.max(32, ...)` 下限意味着柱数极多（band < 32px）时相邻居中 tick 文本仍可能重叠 | 备忘；极多柱时可考虑缩小 tick 字号或允许更短截断 |
| N3 | frontend/src/components/ConnectionConfig.tsx:110-121 | handleConfirmDetected 无异常处理：updateProviderModels 网络失败时 unhandled rejection，UI 无提示（handleAddModel 同病，属既有模式，非本次引入） | 低优先；如统一处理，给一句错误提示即可，不必降级 |
| N4 | frontend/src/components/StatsPanel.tsx:55-66 | ElidedTick 对 surrogate pair（emoji）按两个宽字符计，估算偏保守；`‥` 宽度靠 `cut - 1` 近似补偿。继承第一轮 N1，效果可接受 | 备忘，无需改动 |

## 准入结论

**结论**：`不准入`

**说明**：B1（宽度测量从未挂载，改动 4 未生效且比旧版截断更狠）为功能回归，须修复后复核；S1'/S2' 均为一行级修复，建议与 B1 一并处理后再次检视。
