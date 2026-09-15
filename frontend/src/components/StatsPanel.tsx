import { useState, useEffect, useMemo, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getHistory, getStats } from "@/lib/api";
import type { Provider, TestHistory, StatsResponse } from "@/types";
import { BarChart3, TrendingUp, Loader2, RotateCcw } from "lucide-react";
import ModelSelector, { type ModelGroup } from "@/components/ModelSelector";
import TimeRangeFilter from "@/components/TimeRangeFilter";
import { filterTestsByRange, PRESET_LABELS, type TimeRangeValue } from "@/lib/timeRange";
import {
  modelDisplayLabel,
  recordKey,
  recordProviderKey,
  resolveProviderName,
} from "@/lib/modelLabel";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  LabelList,
} from "recharts";

type Metric = "tps" | "total_latency_ms" | "ttft_ms" | "success_rate";

/** 柱状图轴 tick：长文本超宽时省略号截断，而不是被裁剪/重叠。
 *
 * 横轴（X）居中显示；纵轴（Y）右对齐。超长时截断并带 <title> 悬浮全文。
 */
function ElidedTick({
  x,
  y,
  payload,
  width,
  maxWidth = 140,
  textAnchor = "middle",
}: {
  x?: number;
  y?: number;
  payload?: { value: string };
  width?: number;
  maxWidth?: number;
  textAnchor?: "start" | "middle" | "end";
}) {
  const full = payload?.value ?? "";
  const w = Math.min(width ?? maxWidth, maxWidth);
  // 6.6 ≈ 11px 字号下每字符估算宽
  const truncateLen = Math.max(1, Math.floor(w / 6.6) - 1);
  const shown = full.length > truncateLen ? `${full.slice(0, truncateLen)}…` : full;
  return (
    <text x={x} y={y} fill="oklch(0.708 0 0)" fontSize={11} textAnchor={textAnchor} dy={4}>
      <title>{full}</title>
      {shown}
    </text>
  );
}

const METRIC_LABELS: Record<Metric, string> = {
  tps: "有效速度(tok/s)",
  total_latency_ms: "延迟(ms)",
  ttft_ms: "TTFT(ms)",
  success_rate: "成功率",
};

/** 统计口径：按输入 modelid 还是服务端解析出的 actual_model 分组。 */
type GroupMode = "actual" | "input";

const GROUP_MODE_LABELS: Record<GroupMode, string> = {
  actual: "解析 modelid",
  input: "输入 modelid",
};

/** 按统计口径取一条记录用于分组的 model。
 * 解析模式优先用服务端回传的 actual_model；为空时返回 null（该样本不计入统计）。
 * 失败样本（占位 "error"）回退按输入 modelid 归组：成功率统计必须计入失败样本，
 * 否则解析口径下成功率恒为 100%；数值指标路径均先过滤 success，不受回退影响。 */
function groupModelOf(t: TestHistory, mode: GroupMode): string | null {
  if (mode === "input") return t.model;
  const am = t.actual_model;
  if (am && am !== "error") return am;
  if (!t.success && t.model && t.model !== "error") return t.model;
  return null;
}

/** median(P50)：长尾分布下比 mean 稳定。 */
function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const MODEL_COLORS = [
  "oklch(0.922 0.176 149.238)",   // green
  "oklch(0.688 0.162 258.338)",   // blue
  "oklch(0.769 0.188 70.08)",     // amber
  "oklch(0.627 0.265 303.9)",     // purple
  "oklch(0.715 0.143 215.221)",   // cyan
  "oklch(0.828 0.189 84.429)",    // yellow
  "oklch(0.64 0.082 229.91)",     // slate
  "oklch(0.685 0.169 27.33)",     // red
];

function getModelColor(idx: number) {
  return MODEL_COLORS[idx % MODEL_COLORS.length];
}

function rangeLabel(range: TimeRangeValue): string {
  if (range.type === "preset") return PRESET_LABELS[range.key];
  return `${range.from} ~ ${range.to}`;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** 成功率趋势的时间分桶大小，随时间范围缩放。 */
function bucketSizeFor(range: TimeRangeValue): number {
  if (range.type === "custom") {
    // 自定义区间：按跨度自适应分桶，分钟级起
    const from = new Date(range.from).getTime();
    const to = new Date(range.to).getTime();
    if (Number.isNaN(from) || Number.isNaN(to)) return HOUR_MS;
    const span = to - from;
    if (span <= 2 * HOUR_MS) return 5 * MINUTE_MS;
    if (span <= 24 * HOUR_MS) return HOUR_MS;
    if (span <= 7 * DAY_MS) return 6 * HOUR_MS;
    return DAY_MS;
  }
  switch (range.key) {
    case "1h":
      return 5 * MINUTE_MS;
    case "8h":
      return 15 * MINUTE_MS;
    case "24h":
      return HOUR_MS;
    case "7d":
      return 6 * HOUR_MS;
    case "all":
      return DAY_MS;
  }
}

function formatTime(ts: number, range: TimeRangeValue) {
  const d = new Date(ts);
  if (range.type === "preset") {
    switch (range.key) {
      case "1h":
      case "8h":
      case "24h":
        return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      case "7d":
        return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, "0")}:00`;
      default:
        return `${d.getFullYear()}/${d.getMonth() + 1}`;
    }
  }
  // custom：按分钟刻度（精确到时刻）
  return d.toLocaleString([], { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

interface Props {
  refreshKey: number;
  providers: Provider[];
}

export default function StatsPanel({ refreshKey, providers }: Props) {
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [allTests, setAllTests] = useState<TestHistory[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [timeRange, setTimeRange] = useState<TimeRangeValue>({ type: "preset", key: "24h" });
  const [metric, setMetric] = useState<Metric>("tps");
  const [groupMode, setGroupMode] = useState<GroupMode>("actual");
  const [lastUpdated, setLastUpdated] = useState("");

  // 当前口径下的 model 与分组 key（provider|model），与 ModelSelector 组 key 一致
  // 解析模式下无有效 actual_model 时 model/key 为 null，表示该样本不计入统计
  const testModel = useCallback((t: TestHistory) => groupModelOf(t, groupMode), [groupMode]);
  const keyFor = useCallback(
    (t: TestHistory): string | null => {
      const m = testModel(t);
      return m === null ? null : recordKey(providers, { ...t, model: m });
    },
    [providers, testModel]
  );

  const fetchData = async () => {
    setLoading(true);
    try {
      const [s, h] = await Promise.all([getStats(), getHistory(500, 0)]);
      setStats(s);
      // Ensure data has proper time objects
      const sorted = [...h].sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );
      setAllTests(sorted);
      // 默认全选所有出现过数据的 (provider, model) 对（含失败）；解析模式下无有效 actual_model 的样本被忽略
      setSelectedKeys((prev) => {
        if (prev.size > 0) return prev;
        const keys = new Set<string>();
        for (const t of sorted) {
          const k = keyFor(t);
          if (k !== null) keys.add(k);
        }
        return keys;
      });
      setLastUpdated(new Date().toLocaleTimeString());
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [refreshKey]);

  // ── 对与颜色（单一来源）─────────────────────────────

  // 所有出现过的 (provider, model) 对，按 (provider名, model) 排序，颜色取 index
  const pairKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const t of allTests) {
      const k = keyFor(t);
      if (k !== null) keys.add(k);
    }
    return [...keys].sort((a, b) => {
      const [pa, ma] = a.split("|");
      const [pb, mb] = b.split("|");
      return pa.localeCompare(pb) || ma.localeCompare(mb);
    });
  }, [allTests, keyFor]);

  const pairIndex = useMemo(() => {
    const m = new Map<string, number>();
    pairKeys.forEach((k, i) => m.set(k, i));
    return m;
  }, [pairKeys]);

  const pairColor = useCallbackKeyColor(pairIndex);

  // 对 → 展示名：优先从 allTests 找一条该对记录取完整 provider 信息。
  // 存储时即重映射为分组口径下的记录（model 已替换），避免调用点非空断言。
  const labelForPair = useMemo(() => {
    const repByKey = new Map<string, TestHistory>();
    for (const t of allTests) {
      const m = testModel(t);
      if (m === null) continue;
      const remapped = { ...t, model: m };
      const k = recordKey(providers, remapped);
      if (!repByKey.has(k)) repByKey.set(k, remapped);
    }
    return (key: string) => {
      const rep = repByKey.get(key);
      if (rep) return modelDisplayLabel(providers, rep);
      const [pid, model] = key.split("|");
      return modelDisplayLabel(providers, { model, provider_id: pid });
    };
  }, [allTests, testModel, providers]);

  // 过滤：时间范围 + 选中的对
  const timeFiltered = useMemo(
    () => filterTestsByRange(allTests, timeRange),
    [allTests, timeRange]
  );

  // 选择器分组：目录 provider + 幽灵组；仅保留当前时间范围内有数据的模型
  const groups: ModelGroup[] = useMemo(() => {
    const modelsInRange = new Set<string>();
    // 每个记录归属的 provider key 及其历史模型
    const modelsByProvider = new Map<string, Set<string>>();
    for (const t of timeFiltered) {
      const m = testModel(t);
      if (m === null) continue; // 解析模式下无有效 actual_model，忽略该样本
      const pk = recordProviderKey(providers, t);
      modelsInRange.add(m);
      if (!modelsByProvider.has(pk)) modelsByProvider.set(pk, new Set());
      modelsByProvider.get(pk)!.add(m);
    }
    const result: ModelGroup[] = providers.map((p) => ({
      id: p.id,
      name: p.name,
      models: [...new Set([...(p.models || []), ...(modelsByProvider.get(p.id) ?? [])])].filter(
        (m) => modelsInRange.has(m)
      ),
    }));
    const existing = new Set(result.map((g) => g.id));
    const ghostByKey = new Map<string, { models: string[]; rep: TestHistory }>();
    for (const [pk, models] of modelsByProvider) {
      if (existing.has(pk)) continue;
      if (!ghostByKey.has(pk)) {
        const rep = allTests.find((t) => recordProviderKey(providers, t) === pk)!;
        ghostByKey.set(pk, { models: [], rep });
      }
      const entry = ghostByKey.get(pk)!;
      for (const m of models) if (!entry.models.includes(m)) entry.models.push(m);
    }
    for (const [pk, { models, rep }] of ghostByKey) {
      result.push({ id: pk, name: resolveProviderName(providers, rep), models });
    }
    return result;
  }, [providers, allTests, timeFiltered, testModel]);

  const filteredTests = useMemo(() => {
    // 空选择（用户清空筛选）→ 不展示任何数据；默认全选在 fetchData 里填充
    if (selectedKeys.size === 0) return [];
    return timeFiltered.filter(t => {
      const k = keyFor(t);
      return k !== null && selectedKeys.has(k);
    });
  }, [timeFiltered, selectedKeys, keyFor]);

  // Stats cards
  const cardStats = useMemo(() => {
    const success = filteredTests.filter(t => t.success);
    const total = filteredTests.length;
    if (total === 0) return null;
    const tpsVals = success.filter(t => t.tps !== null).map(t => t.tps as number);
    return {
      total,
      successRate: total > 0 ? Math.round((success.length / total) * 100) : 0,
      avgTps: tpsVals.length > 0 ? median(tpsVals) : null,
      avgLatency: success.length > 0 ? median(success.map(t => t.total_latency_ms)) : 0,
    };
  }, [filteredTests]);

  const isSuccessRate = metric === "success_rate";

  // 时间序列：按 (provider, model) 对分组（仅数值指标；成功率用 successRateSeries 分桶）
  const timeSeriesByPair = useMemo(() => {
    if (isSuccessRate) return {};
    const byPair: Record<string, { time: number; value: number }[]> = {};
    filteredTests.filter(t => t.success).forEach(t => {
      const v = t[metric];
      if (v === null || v === undefined) return; // TTFT 对 non-stream 为 null，跳过
      const k = keyFor(t);
      if (k === null) return; // 解析模式下无有效 actual_model，忽略
      if (!byPair[k]) byPair[k] = [];
      byPair[k].push({
        time: new Date(t.created_at).getTime(),
        value: v,
      });
    });
    Object.values(byPair).forEach(arr => arr.sort((a, b) => a.time - b.time));
    return byPair;
  }, [filteredTests, metric, isSuccessRate, keyFor]);

  // 成功率趋势：按时间分桶聚合（含失败样本），而非逐样本打点
  const successRateSeries = useMemo(() => {
    const bucket = bucketSizeFor(timeRange);
    const byPair: Record<string, Map<number, { total: number; success: number }>> = {};
    for (const t of filteredTests) {
      const k = keyFor(t);
      if (k === null) continue;
      const time = Math.floor(new Date(t.created_at).getTime() / bucket) * bucket;
      if (!byPair[k]) byPair[k] = new Map();
      const e = byPair[k].get(time) ?? { total: 0, success: 0 };
      e.total += 1;
      if (t.success) e.success += 1;
      byPair[k].set(time, e);
    }
    const out: Record<string, { time: number; value: number }[]> = {};
    for (const [k, m] of Object.entries(byPair)) {
      out[k] = [...m.entries()]
        .map(([time, e]) => ({ time, value: Math.round((e.success / e.total) * 100) }))
        .sort((a, b) => a.time - b.time);
    }
    return out;
  }, [filteredTests, keyFor, timeRange]);

  // 趋势数据源：成功率用分桶序列，其余指标用逐样本序列
  const timeSeriesForMetric = isSuccessRate ? successRateSeries : timeSeriesByPair;

  const pairsWithData = Object.keys(timeSeriesForMetric);
  const showSmallMultiples = pairsWithData.length > 1;
  const globalMaxValue = Math.max(
    ...Object.values(timeSeriesForMetric).flatMap(arr => arr.map(d => d.value)),
    1
  );

  // 模型对比：按对，组内取 median(P50)（仅数值指标；成功率用 successRateData）
  const modelComparison = useMemo(() => {
    if (isSuccessRate) return [];
    const byPair: Record<string, number[]> = {};
    filteredTests.filter(t => t.success).forEach(t => {
      const v = t[metric];
      if (v === null || v === undefined) return; // TTFT/有效速度对 non-stream 为 null，跳过
      const k = keyFor(t);
      if (k === null) return; // 解析模式下无有效 actual_model，忽略
      if (!byPair[k]) byPair[k] = [];
      byPair[k].push(v);
    });
    return Object.entries(byPair)
      .map(([key, vals]) => ({
        key,
        name: labelForPair(key),
        value: Math.round(median(vals) * 100) / 100,
        count: vals.length,
      }))
      .sort((a, b) => b.value - a.value);
  }, [filteredTests, metric, isSuccessRate, labelForPair, keyFor]);

  // 成功率：按对，含失败
  const successRateData = useMemo(() => {
    const byPair: Record<string, { total: number; success: number }> = {};
    filteredTests.forEach(t => {
      const k = keyFor(t);
      if (k === null) return; // 解析模式下无有效 actual_model，忽略
      if (!byPair[k]) byPair[k] = { total: 0, success: 0 };
      byPair[k].total += 1;
      if (t.success) byPair[k].success += 1;
    });
    return Object.entries(byPair)
      .map(([key, d]) => ({
        key,
        name: labelForPair(key),
        total: d.total,
        success: d.success,
        rate: d.total > 0 ? Math.round((d.success / d.total) * 1000) / 10 : 0,
      }))
      .sort((a, b) => a.rate - b.rate);
  }, [filteredTests, labelForPair, keyFor]);

  // 对比数据源：成功率用含失败样本的按对成功率，其余指标用按对中位数
  const comparisonData = isSuccessRate ? successRateData : modelComparison;

  // 目录变化时清除已不存在的选中对（幽灵残留）
  useEffect(() => {
    setSelectedKeys((prev) => {
      if (prev.size === 0) return prev;
      const valid = new Set<string>();
      for (const g of groups) {
        for (const m of g.models) valid.add(`${g.id}|${m}`);
      }
      const next = new Set<string>();
      let changed = false;
      for (const k of prev) {
        if (valid.has(k)) next.add(k);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [groups]);

  const toggleKey = (key: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // 切换统计口径：重置选中（key 已变化），默认全选新口径下所有出现的对
  const changeGroupMode = useCallback((mode: GroupMode) => {
    setGroupMode(mode);
    const keys = new Set<string>();
    for (const t of allTests) {
      const m = groupModelOf(t, mode);
      if (m !== null) keys.add(recordKey(providers, { ...t, model: m }));
    }
    setSelectedKeys(keys);
  }, [allTests, providers]);

  const toggleAll = (groupId: string, models: string[], select: boolean) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      for (const m of models) {
        const key = `${groupId}|${m}`;
        if (select) next.add(key);
        else next.delete(key);
      }
      return next;
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!stats || stats.total_tests === 0) {
    return (
      <div className="text-sm text-muted-foreground text-center py-16">
        暂无统计数据，先跑一次测速吧
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">统计</span>
          {lastUpdated && (
            <span className="text-[10px] text-muted-foreground ml-1">
              更新于 {lastUpdated}
            </span>
          )}
        </div>
        <Button variant="ghost" size="sm" onClick={fetchData}>
          <RotateCcw className="w-3.5 h-3.5" />
        </Button>
      </div>

      {/* ── Filters ── */}
      <div className="flex flex-wrap gap-3 items-start">
        {/* 模型选择器（按 provider 分组，选中的上色） */}
        <div className="flex-1 min-w-[240px]">
          <ModelSelector
            groups={groups}
            selectedKeys={selectedKeys}
            onToggle={toggleKey}
            onToggleAll={toggleAll}
            colorSelected={pairColor}
            title=""
          />
        </div>

        {/* 时间 / 口径 / 指标 垂直排列 */}
        <div className="flex flex-col gap-3">
          {/* Time range selector */}
          <TimeRangeFilter value={timeRange} onChange={setTimeRange} />

          {/* 统计口径：按输入或解析后的 modelid 分组 */}
          <div className="space-y-1.5">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">口径</span>
            <div className="flex gap-1">
              {(Object.keys(GROUP_MODE_LABELS) as GroupMode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => changeGroupMode(m)}
                  className="cursor-pointer"
                  title={m === "actual" ? "按服务端返回的实际模型 ID 分组" : "按发起测速时输入的模型 ID 分组"}
                >
                  <Badge
                    variant={groupMode === m ? "default" : "outline"}
                    className="text-[10px] px-1.5 py-0"
                  >
                    {GROUP_MODE_LABELS[m]}
                  </Badge>
                </button>
              ))}
            </div>
          </div>

          {/* Metric selector */}
          <div className="space-y-1.5">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">指标</span>
            <div className="flex gap-1">
              {(Object.keys(METRIC_LABELS) as Metric[]).map(m => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMetric(m)}
                  className="cursor-pointer"
                >
                  <Badge
                    variant={metric === m ? "default" : "outline"}
                    className="text-[10px] px-1.5 py-0"
                  >
                    {METRIC_LABELS[m]}
                  </Badge>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* 有选中项但过滤后无数据（如解析口径下样本全被剔除/时间范围无记录） */}
      {filteredTests.length === 0 && selectedKeys.size > 0 && (
        <p className="text-sm text-muted-foreground text-center py-10">
          当前统计口径/时间范围内没有可展示的数据
        </p>
      )}

      {/* ── Aggregate Cards ── */}
      {cardStats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <MetricCard label="测试次数" value={cardStats.total} />
          <MetricCard label="成功率" value={`${cardStats.successRate}%`} />
          <MetricCard
            label="中位有效速度"
            value={cardStats.avgTps !== null ? Math.round(cardStats.avgTps * 100) / 100 : "N/A"}
          />
          <MetricCard label="中位延迟" value={`${Math.round(cardStats.avgLatency)}ms`} />
        </div>
      )}

      {/* ── Model Comparison Bar ── */}
      {comparisonData.length > 0 && (
        <>
          <div className="flex items-center gap-2">
            <BarChart3 className="w-3.5 h-3.5 text-primary" />
            <span className="text-xs font-medium">
              模型对比 — {METRIC_LABELS[metric]}
            </span>
          </div>
          <Card className="border-0 bg-card/50">
            <CardContent className="p-4">
              {isSuccessRate ? (
                <ResponsiveContainer width="100%" height={Math.max(140, successRateData.length * 32)}>
                  <BarChart
                    data={successRateData}
                    layout="vertical"
                    margin={{ left: 16, right: 56, top: 4, bottom: 4 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.269 0 0)" horizontal={false} />
                    <XAxis
                      type="number"
                      domain={[0, 100]}
                      tickFormatter={(v) => `${v}%`}
                      stroke="oklch(0.708 0 0)"
                      fontSize={11}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={140}
                      tickLine={false}
                      axisLine={false}
                      tick={<ElidedTick maxWidth={140} textAnchor="end" />}
                    />
                    <Tooltip
                      contentStyle={{
                        borderRadius: "8px",
                        fontSize: "12px",
                      }}
                      formatter={(val: number, _name, entry) => {
                        const d = entry.payload as { success: number; total: number };
                        return [`${val}% (${d.success}/${d.total})`, "成功率"];
                      }}
                    />
                    <Bar dataKey="rate" radius={[0, 4, 4, 0]} animationDuration={600}>
                      {successRateData.map((d) => (
                        <Cell key={d.key} fill={pairColor(d.key)} />
                      ))}
                      <LabelList
                        dataKey="rate"
                        position="right"
                        formatter={(v: number, entry?: { payload?: { success?: number; total?: number } }) => {
                          const p = entry?.payload;
                          return `${v}% (${p?.success ?? 0}/${p?.total ?? 0})`;
                        }}
                        style={{ fill: "oklch(0.708 0 0)", fontSize: 11 }}
                      />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={modelComparison}>
                    <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.269 0 0)" vertical={false} />
                    <XAxis
                      dataKey="name"
                      stroke="oklch(0.708 0 0)"
                      tickLine={false}
                      axisLine={false}
                      interval={0}
                      tick={<ElidedTick />}
                    />
                    <YAxis stroke="oklch(0.708 0 0)" fontSize={11} tickLine={false} axisLine={false} />
                    <Tooltip
                      contentStyle={{
                        borderRadius: "8px",
                        fontSize: "12px",
                      }}
                      formatter={(val: number) => [val.toFixed(2), METRIC_LABELS[metric]]}
                    />
                    <Bar
                      dataKey="value"
                      radius={[4, 4, 0, 0]}
                      animationBegin={0}
                      animationDuration={600}
                    >
                      {modelComparison.map((entry) => (
                        <Cell key={entry.key} fill={pairColor(entry.key)} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* ── Time Series ── */}
      {pairsWithData.length > 0 && (
        <>
          <div className="flex items-center gap-2">
            <TrendingUp className="w-3.5 h-3.5 text-primary" />
            <span className="text-xs font-medium">
              {METRIC_LABELS[metric]} 趋势
              {(timeRange.type !== "preset" || timeRange.key !== "all") &&
                ` — ${rangeLabel(timeRange)}`}
            </span>
            {timeRange.type === "preset" && timeRange.key === "all" && pairsWithData.length === 1 && (
              <span className="text-[10px] text-muted-foreground">
                {timeSeriesForMetric[pairsWithData[0]].length} 个数据点
              </span>
            )}
          </div>

          {showSmallMultiples ? (
            /* Small Multiples: one chart per pair */
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {pairsWithData.sort().map((key) => {
                const data = timeSeriesForMetric[key];
                if (data.length < 2) return null;
                const label = labelForPair(key);
                return (
                  <Card key={key} className="border-0 bg-card/50">
                    <CardContent className="p-3">
                      <p className="text-[11px] font-medium mb-1 truncate" title={label}>
                        {label}
                      </p>
                      <p className="text-[10px] text-muted-foreground -mt-0.5 mb-2">
                        avg {data.reduce((s, d) => s + d.value, 0) / data.length | 0}
                        {isSuccessRate ? "%" : ""} {METRIC_LABELS[metric]}
                      </p>
                      <ResponsiveContainer width="100%" height={100}>
                        <LineChart data={data}>
                          <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.269 0 0)" />
                          <XAxis
                            dataKey="time"
                            type="number"
                            domain={["dataMin", "dataMax"]}
                            tick={false}
                            axisLine={false}
                          />
                          <YAxis
                            domain={isSuccessRate ? [0, 100] : [0, globalMaxValue * 1.1]}
                            tick={false}
                            axisLine={false}
                          />
                          <Tooltip
                            contentStyle={{
                              background: "oklch(0.205 0 0)",
                              border: "1px solid oklch(0.269 0 0)",
                              borderRadius: "6px",
                              fontSize: "11px",
                            }}
                            labelFormatter={(ts: number) => new Date(ts).toLocaleString()}
                            formatter={(val: number) =>
                              isSuccessRate
                                ? [`${val}%`, METRIC_LABELS[metric]]
                                : [val.toFixed(1), METRIC_LABELS[metric]]
                            }
                          />
                          <Line
                            type="monotone"
                            dataKey="value"
                            stroke={pairColor(key)}
                            strokeWidth={1.5}
                            dot={false}
                            connectNulls={false}
                            animationDuration={800}
                          />
                          <ReferenceLine
                            y={data.reduce((s, d) => s + d.value, 0) / data.length}
                            stroke="oklch(0.708 0 0)"
                            strokeDasharray="4 4"
                            strokeOpacity={0.4}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          ) : (
            /* Single pair: big clean chart */
            <Card className="border-0 bg-card/50">
              <CardContent className="p-4">
                <ResponsiveContainer width="100%" height={240}>
                  <LineChart data={timeSeriesForMetric[pairsWithData[0]]}>
                    <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.269 0 0)" vertical={false} />
                    <XAxis
                      dataKey="time"
                      type="number"
                      domain={["dataMin", "dataMax"]}
                      scale="time"
                      stroke="oklch(0.708 0 0)"
                      fontSize={11}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(ts) => formatTime(ts, timeRange)}
                    />
                    <YAxis
                      stroke="oklch(0.708 0 0)"
                      fontSize={11}
                      tickLine={false}
                      axisLine={false}
                      domain={isSuccessRate ? [0, 100] : ["auto", "auto"]}
                    />
                    <Tooltip
                      contentStyle={{
                        background: "oklch(0.205 0 0)",
                        border: "1px solid oklch(0.269 0 0)",
                        borderRadius: "8px",
                        fontSize: "12px",
                      }}
                      labelFormatter={(ts: number) => new Date(ts).toLocaleString()}
                      formatter={(val: number) =>
                        isSuccessRate
                          ? [`${val}%`, METRIC_LABELS[metric]]
                          : [val.toFixed(2), METRIC_LABELS[metric]]
                      }
                    />
                    <Line
                      type="monotone"
                      dataKey="value"
                      stroke={pairColor(pairsWithData[0])}
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 5, strokeWidth: 0 }}
                      connectNulls={false}
                      animationDuration={600}
                    />
                    <ReferenceLine
                      y={
                        timeSeriesForMetric[pairsWithData[0]].reduce((s, d) => s + d.value, 0) /
                        timeSeriesForMetric[pairsWithData[0]].length
                      }
                      stroke="oklch(0.708 0 0)"
                      strokeDasharray="4 4"
                      strokeOpacity={0.5}
                      label={{
                        value: "avg",
                        position: "insideBottomRight",
                        fill: "oklch(0.708 0 0)",
                        fontSize: 10,
                      }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function MetricCard({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <Card className="border-0 bg-card/50">
      <CardContent className="p-3 text-center">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-lg font-semibold tabular-nums mt-0.5">{value}</p>
      </CardContent>
    </Card>
  );
}

// 由于 useMemo 不能直接引用不稳定函数，这里用 useMemo 封一层稳定 color 函数
function useCallbackKeyColor(pairIndex: Map<string, number>) {
  return useMemo(() => {
    const map = pairIndex;
    return (key: string) => getModelColor(map.get(key) ?? 0);
  }, [pairIndex]);
}
