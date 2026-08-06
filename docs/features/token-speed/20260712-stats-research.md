# Stats Panel Redesign — 调研报告

> 调研日期: 2026-07-12
> 目的: 为 Token Speed 统计面板的重新设计提供 solid 的设计参考和最佳实践依据。

---

## 目录

1. [核心设计原则](#1-核心设计原则)
2. [模型过滤模式 (Filter by Model)](#2-模型过滤模式-filter-by-model)
3. [时间序列趋势图 (Time-Series Trend)](#3-时间序列趋势图-time-series-trend)
4. [多模型对比不过度拥挤 (Multi-Model Comparison)](#4-多模型对比不过度拥挤-multi-model-comparison)
5. [跳动感 / 实时感 (Live/Real-time Feel)](#5-跳动感--实时感-livereal-time-feel)
6. [推荐实施方案](#6-推荐实施方案)
7. [参考来源](#7-参考来源)

---

## 1. 核心设计原则

### 1.1 每张图只说一件事
> 来源: Metabase 时间序列最佳实践

"Each chart should communicate one key insight. For multiple insights, use separate visualizations." 统计面板应当拆分为:
- **概况指标卡**: 总测试数、成功率、平均 TPS、平均延迟 — 聚合在一个指标行
- **模型对比图**: 聚焦于模型间横向比较
- **时间序列趋势图**: 聚焦于单模型/多模型随时间的变化

### 1.2 交互层次: Overview → Filter → Details
> 来源: Tinybird 实时可视化、Grafana dashboard best practices

标准 dashboard 交互流程:
1. **Overview**: 看到全局快照 (聚合指标)
2. **Filter**: 选择想深入分析的维度 (模型、时间范围)
3. **Details**: 看到过滤后的细粒度趋势

### 1.3 数据形状决定图表类型
> 来源: Metabase

| 场景 | 推荐图表 | 理由 |
|------|----------|------|
| 单指标随时间变化 | 折线图 | 趋势一目了然 |
| 多模型同一指标对比 | 分组柱状图 / 小多图 | 横向比较 |
| 多指标随时间变化 | 多系列折线图 + 交互图例 | 可切换查看 |
| 累计量变化 | 面积图 | 强调大小而非趋势 |

---

## 2. 模型过滤模式 (Filter by Model)

### 2.1 标准 Dashboard 过滤架构
> 来源: Grafana, Tinybird, PowerBI 实践

```
┌──────────────────────────────────────────┐
│  全局过滤器: [模型下拉框 ▼] [时间范围 ▼]   │
├──────────────────────────────────────────┤
│  ┌────────┐ ┌────────┐ ┌────────┐       │
│  │ 总测试  │ │ 成功率  │ │ 平均TPS │ ...  │  ← 聚合卡片随过滤变化
│  └────────┘ └────────┘ └────────┘       │
├──────────────────────────────────────────┤
│   模型对比柱状图 (仅显示选中模型)          │
├──────────────────────────────────────────┤
│   时间序列趋势 (选中模型的 TPS 随时间变化) │
└──────────────────────────────────────────┘
```

### 2.2 过滤器设计模式

**模式 A: 单一模型选择 + 聚合概览** (推荐当前场景)
- 下拉框默认 "全部模型"
- 选择特定模型 → 全局指标卡、柱状图、趋势图全部响应
- 优点: 实现简单，数据清晰不拥挤

**模式 B: 多选 + 对比模式**
- 支持多选模型，趋势图中同时绘制多条线
- 通过交互图例控制显示/隐藏
- 适合需要直接对比的场景

**模式 C: 模型优先**
- 页面首先展示的是一个模型选择界面
- 选择了之后再进入深度 stats 视图
- 适合管理大量模型 (>20) 的场景

### 2.3 过滤状态管理建议

```typescript
// 推荐的状态结构
interface StatsFilterState {
  selectedModels: string[];   // 选中的模型列表, [] 表示全部
  timeRange: '7d' | '30d' | 'all' | [Date, Date];
  metric: 'tps' | 'latency' | 'ttft';
}
```

- 过滤变化时应**保留图表状态** (不重置缩放/滚动)
- 使用 URL query params 保持状态可分享 (可选)
- 过滤变化时图表应平滑过渡 (Recharts 的 `animationMatchBy` 支持)

---

## 3. 时间序列趋势图 (Time-Series Trend)

### 3.1 日期/时间轴配置

Recharts 的正确时间轴做法:

```tsx
// 后端返回的数据包含 ISO datetime 字符串
interface TestHistory {
  created_at: string; // "2026-07-12T10:30:00Z"
  tps: number;
  model: string;
}

// 前端需要对数据进行预处理
const processed = data.map(d => ({
  ...d,
  time: new Date(d.created_at).getTime(), // 转为 Unix timestamp ms
}));

// XAxis 配置
<XAxis
  dataKey="time"
  type="number"
  domain={['dataMin', 'dataMax']}
  tickFormatter={(ts) => dayjs(ts).format('HH:mm')}
  scale="time"
/>
```

> 关键: Recharts 的时间轴使用 `type="number"` + `scale="time"` 的组合。参考 Recharts Issue #956 和社区实践。

### 3.2 时间轴刻度策略

| 数据量级 | 建议刻度 | 格式化 |
|----------|----------|--------|
| 最近 1 小时内 | 每 5 分钟 | `HH:mm` |
| 最近 24 小时 | 每小时 | `HH:mm` |
| 最近 7 天 | 每天 | `MM/DD` |
| 最近 30 天 | 每周 | `MM/DD` |
| 全部历史 | 每月 | `YYYY/MM` |

### 3.3 时间轴最佳实践
> 来源: Grafana Time Series 文档, Metabase

- **始终使用绝对时间**: 不要用序号索引，直接使用 `created_at` 字段
- **间距等距**: 即使数据点不均匀，时间轴也应保持正确的时距 (Recharts `scale="time"` 自动处理)
- **显示时间范围和最后更新时间**: 在图表角落标注 `Last updated: 10:32:15`
- **空值处理**: 对于缺失时间点，使用 `connectNulls={false}` 在 Recharts 中 (断线表示缺少数据)

---

## 4. 多模型对比不过度拥挤 (Multi-Model Comparison)

### 4.1 方案对比

| 方案 | 适用场景 | 优点 | 缺点 |
|------|----------|------|------|
| **单图多线 + 交互图例** | 3-5 个模型 | 直接对比 | 超过 5 条线则拥挤 |
| **小多图 (Small Multiples)** | 5-20 个模型 | 各自独立坐标系，互不干扰 | 无法直接跨图对比数值 |
| **模型过滤 + 单线图** | 大量模型 (>10) | 最清晰 | 只能一次看一个模型 |
| **热度图 / 色块矩阵** | 大量模型 + 长时间 | 全局密度感知 | 精确数值阅读困难 |

### 4.2 小多图 (Small Multiples) — 强烈推荐
> 来源: Datawrapper, Wikipedia, CDC COVE

**适用场景**: 当你有 5 个以上的模型时，把所有模型的线画在一张图上会变成 "一团意大利面"。小多图将每个模型拆到独立的小面板中，使用相同的坐标轴比例，使得:
- 每条线都有自己的 "呼吸空间"
- 读者可以看清单个模型的趋势
- 相同坐标轴保证了跨模型的视觉可比性

**小多图设计最佳实践** (来自 Datawrapper):
- **让图变小但可读**: "The eye can detect, with great efficiency even at small resolution, variation in size, position, colour and pattern."
- **使用颜色做分类, 而非区分**: 所有模型线条用同色，保留颜色用于高亮异常或分类
- **有意义的排序**: 按 TPS 均值排序、按最后测试时间排序、按变化幅度排序
- **在背景中绘制所有模型的淡影线**: 帮助读者锚定 "这个模型在整体中处于什么位置"
- **平衡面板数量**: 4-9 面板最理想；超过则考虑分页或仅显示选中模型

**React 实现要点**:
```tsx
// 小多图实现: 一个模型一个 LineChart, 放在 grid 中
<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
  {filteredModels.map(model => (
    <Card key={model}>
      <CardContent>
        <p className="text-xs font-medium mb-1">{model}</p>
        <ResponsiveContainer width="100%" height={120}>
          <LineChart data={dataByModel[model]}>
            {/* 使用固定 Y 轴全域: domain={[0, globalMaxTps]} */}
            <Line type="monotone" dataKey="tps" stroke="..." dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  ))}
</div>
```

### 4.3 交互图例 + 过滤

当最多只展示 3-5 个模型时，使用交互图例是更好的选择:

```tsx
// 自定义交互图例
const [hiddenModels, setHiddenModels] = useState<Set<string>>(new Set());

const handleLegendClick = (model: string) => {
  setHiddenModels(prev => {
    const next = new Set(prev);
    if (next.has(model)) next.delete(model);
    else next.add(model);
    return next;
  });
};

// 在 LineChart 中仅绘制未被隐藏的模型
<LineChart>
  {visibleModels.map(model => (
    <Line
      key={model}
      dataKey={`tps_${model}`}
      stroke={colorMap[model]}
      strokeOpacity={hiddenModels.has(model) ? 0.2 : 1}
    />
  ))}
</LineChart>
```

> 来源: Recharts GitHub Discussion #3940 — Legend click to filter series

### 4.4 推荐策略

```
# 模型数量 → 显示策略
1个       → 大折线图 (单线)
2-4个     → 多线对比图 + 交互图例 (默认全部显示)
5-15个    → 小多图 (grid 布局)
15+个     → 仅显示选中模型的趋势 + 柱状图对比
```

---

## 5. 跳动感 / 实时感 (Live/Real-time Feel)

### 5.1 什么是 "跳动感"

"跳动感" (live feel) 不是真的实时流数据，而是**用户感知上觉得数据"活着"**。核心在于:
> "It's not 'as fast as possible.' It's **fast enough** for the task, with **predictable latency** and **no UI thrash**."
> — *Real-Time Dashboards That Feel Instant, Nikulsinh Rajput*

### 5.2 实现手法

#### 5.2.1 图表入场动画
> 来源: Recharts Animation Guide

Recharts 支持丰富的动画配置:

```tsx
<Line
  isAnimationActive={true}
  animationBegin={0}
  animationDuration={800}
  animationEasing="ease-out"  // 或 "spring" (Recharts v3.9+)
  // animationEasing="spring" 产生自然的弹性动画
/>
```

| 参数 | 效果 |
|------|------|
| `animationEasing="spring"` | 弹簧物理效果，自然有弹性 |
| `animationDuration={600}` | 适中的动画时长，不拖沓 |
| `animationBegin={0}` | 立即开始，无延迟 |

> **关键**: Recharts v3.9+ 的 `animationMatchBy` prop 让数据更新时的过渡更平滑:
> - `matchByDataKey('timestamp')`: 数据点按时间戳匹配，新增点淡入，旧点淡出
> - `matchAppend`: 仅末尾追加数据时最平滑

#### 5.2.2 主动画点 (activeDot) 与悬浮交互

```tsx
<Line
  activeDot={{
    r: 6,
    strokeWidth: 2,
    stroke: 'oklch(0.922 0.176 149.238)',
    fill: 'oklch(0.205 0 0)',
  }}
/>
```

- 悬浮时高亮数据点，显示 tooltip
- 让用户感觉 "图表对操作有反应"
- Grafana 推荐: Tooltip mode = "All" 或 "Single" 配合 hover proximity

#### 5.2.3 自动刷新

```tsx
// 刷新控制
const [refreshInterval, setRefreshInterval] = useState<number>(30000); // 30s

useEffect(() => {
  const timer = setInterval(() => {
    fetchStats();
  }, refreshInterval);
  return () => clearInterval(timer);
}, [refreshInterval]);
```

- 提供刷新间隔选择: 关闭 / 15s / 30s / 60s
- 刷新时使用 `animationMatchBy('created_at')` 保证平滑过渡
- 不闪屏、不重置图表状态

#### 5.2.4 微交互 (Micro-interactions)
> 来源: FusionCharts Live Charts, NNG Group

- **Tooltip 跟随鼠标**: 显示精确的数值和时间
- **点击图例切换系列**: 即时响应，有过渡
- **Reference Line**: 显示平均值/历史最高值的参考线
- **最后更新标记**: 角落标注 "Updated 3s ago"，随时间变化
- **数据点呼吸效果**: 最新数据点用稍大的圆点 + 脉冲动画

#### 5.2.5 加载过渡

```tsx
// 骨架屏 (shadcn/ui Skeleton)
<div className="space-y-3">
  <Skeleton className="h-[200px] w-full rounded-lg" />
</div>

// 或保留旧数据 + 加载指示器 (比空白加载更好)
<>
  {loading && <div className="absolute top-2 right-2">
    <Loader2 className="w-3 h-3 animate-spin" />
  </div>}
</>
```

### 5.3 "跳动感" Checklist

- [x] 图表入场动画 (isAnimationActive)
- [x] 数据更新过渡 (animationMatchBy)
- [x] 悬浮高亮 (activeDot + Tooltip)
- [x] 交互图例点击切换
- [x] 自动刷新 (可选间隔)
- [x] 最后更新时间戳
- [x] 平滑的加载/过渡状态
- [x] 平均值参考线 (ReferenceLine)

---

## 6. 推荐实施方案

### 6.1 整体面板布局

```
┌──────────────────────────────────────────────────┐
│  [模型选择 ▼]  [时间范围 ▼]  [指标切换 ▼]  [刷新 ○] │  ← 过滤栏
├──────────────────────────────────────────────────┤
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐  │
│  │总测试 │ │成功率 │ │平均TPS│ │平均延迟│  │  ← 聚合卡片
│  │ 142   │ │ 97.2%│ │85.3  │ │1234ms │  │    (响应过滤)
│  └──────┘ └──────┘ └──────┘ └──────┘  │
├──────────────────────────────────────────────────┤
│  模型对比 (柱状图)                                 │  ← 始终显示全部模型
│  ██ ██ ██ ██ ██ ██ ██                            │     (或过滤后子集)
│  ─────────────────────                             │
├──────────────────────────────────────────────────┤
│  ⚡ TPS 趋势 (折线图)                              │  ← 过滤响应
│  ╱╲    ╱╲    ╱╲                                  │     选中模型的时间序列
│ ╱  ╲  ╱  ╲  ╱  ╲                                │
│ ─────────────────────                             │
│                          Updated 30s ago          │
├──────────────────────────────────────────────────┤
│  📊 各模型详细统计表格                              │  ← 可选: 数据表视图
└──────────────────────────────────────────────────┘
```

### 6.2 阶段实施建议

**Phase 1: 基础重设计**
- 加入模型过滤下拉框 (单选 + "全部")
- 将现有 "近期趋势" 改用真实时间轴 (`created_at` as XAxis)
- 实现聚合卡片响应过滤

**Phase 2: 多模型友好**
- 实现 2-4 个模型选中的多线对比
- 实现 5+ 模型时的自动降级为小多图
- 交互图例 (点击隐藏/显示)

**Phase 3: 跳动感**
- 加入入场动画 (`animationEasing="spring"`)
- 数据刷新过渡 (`animationMatchBy`)
- 自动刷新 + 最后更新时间戳
- 平均值参考线 + 悬浮 activeDot

### 6.3 技术要点总结

```tsx
// Recharts v3.9+ 关键 API
interface AnimationConfig {
  isAnimationActive: boolean | 'auto';
  animationBegin: number;         // 延迟开始 ms
  animationDuration: number;      // 动画时长 ms
  animationEasing: 'ease' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'linear' | 'spring' | string;
  animationMatchBy?: 'matchByIndex' 
    | 'matchAppend' 
    | ((item: any, index: number) => string | number | null)
    | ReturnType<typeof matchByDataKey>;
}

// 时间轴最佳实践
<XAxis 
  dataKey="timestamp" 
  type="number" 
  scale="time"
  domain={['auto', 'auto']}
  tickFormatter={(ts) => dayjs(ts).format(tickFormat)}
  tickCount={6}
/>

// 小多图布局
<div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
  {models.map(model => (
    <MiniTrendCard key={model} model={model} data={dataByModel[model]} />
  ))}
</div>

// 交互图例
<Legend 
  onClick={(e) => toggleModel(e.value)}
  onMouseEnter={(e) => highlightModel(e.value)}
  onMouseLeave={() => resetHighlight()}
/>
```

---

## 7. 参考来源

### 时间序列可视化
- 【Metabase】How to visualize time-series data: best practices — https://www.metabase.com/blog/how-to-visualize-time-series-data
- 【Grafana】Time Series Visualization documentation — https://grafana.com/docs/grafana/latest/visualizations/panels-visualizations/visualizations/time-series/
- 【Chart.js】Time Series Axis — https://www.chartjs.org/docs/latest/axes/cartesian/timeseries.html
- arXiv:2507.14920 — Time Series Information Visualization – A Review of Approaches

### 多模型对比与小多图
- 【Datawrapper】What to consider when creating small multiple line charts — https://www.datawrapper.de/blog/what-to-consider-when-creating-small-multiple-line-charts
- 【OKViz】Comparing Many Time Series Clearly with Small Multiple Line Chart — https://okviz.com/review/wa104381711
- 【CDC COVE】Small Multiples — https://www.cdc.gov/cove/data-visualization-types/small-multiples.html
- 【Wikipedia】Small multiple — https://en.wikipedia.org/wiki/Small_multiple

### 实时感 / 动画
- 【Recharts】Animation Guide — https://recharts.github.io/en-US/guide/animations
- 【FusionCharts】The Anatomy of Great Live Charts — https://www.fusioncharts.com/blog/the-anatomy-of-great-live-charts
- 【Medium】Real-Time Dashboards That Feel Instant (Nikulsinh Rajput) — https://medium.com/@hadiyolworld007/real-time-dashboards-that-feel-instant-40a52d989768
- 【Apache ECharts】Data Transition Animation — https://echarts.apache.org/handbook/en/how-to/animation/transition
- 【React Spring】A Friendly Introduction to Spring Physics — https://www.joshwcomeau.com/animation/a-friendly-introduction-to-spring-physics

### Dashboard 设计
- 【Tinybird】Real-time Data Visualization: How to build faster dashboards — https://www.tinybird.co/blog/real-time-data-visualization
- 【Tinybird】We made an open source LLM Performance Tracker — https://www.tinybird.co/blog/introducing-llm-performance-tracker
- 【NNG】Dashboards: Making Charts and Graphs Easier to Understand — https://www.nngroup.com/articles/dashboards-preattentive
- 【DataCamp】Effective Dashboard Design: Principles, Best Practices, and Examples — https://www.datacamp.com/tutorial/dashboard-design-tutorial
- 【Grafana】Dashboard best practices — https://grafana.com/docs/grafana/latest/visualizations/dashboards/build-dashboards/best-practices

### Recharts 实现参考
- Recharts examples — https://recharts.org/en-US/examples
- Multi-series line chart — https://recharts.github.io/en-US/examples/LineChartHasMultiSeries
- Filter by Legend click — https://github.com/recharts/recharts/discussions/3940
- Time series issues — https://github.com/recharts/recharts/issues/956
- Animation matching (v3.9+) — https://recharts.org/en-US/guide/animations#animation-matching

### LTTB 下采样
- Largest Triangle Three Buckets 算法 — https://rajnandan.com/posts/largest-triangle-three-buckets-downsampling
- Downsampling time series data — https://phare.io/blog/downsampling-time-series-data
