import { useState, useEffect, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getHistory, getStats } from "@/lib/api";
import type { Provider, TestHistory, StatsResponse } from "@/types";
import {
  BarChart3,
  TrendingUp,
  Activity,
  Loader2,
  RotateCcw,
  CheckCircle2,
} from "lucide-react";
import ModelSelector, { type ModelGroup } from "@/components/ModelSelector";
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

type Metric = "tps" | "total_latency_ms" | "ttft_ms";
type TimeRange = "1h" | "24h" | "7d" | "30d" | "all";

const METRIC_LABELS: Record<Metric, string> = {
  tps: "TPS",
  total_latency_ms: "延迟(ms)",
  ttft_ms: "TTFT(ms)",
};

const TIME_RANGE_LABELS: Record<TimeRange, string> = {
  "1h": "1小时",
  "24h": "24小时",
  "7d": "7天",
  "30d": "30天",
  "all": "全部",
};

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

function formatTime(ts: number, range: TimeRange) {
  const d = new Date(ts);
  if (range === "1h") return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (range === "24h") return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (range === "7d") return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, "0")}:00`;
  if (range === "30d") return `${d.getMonth() + 1}/${d.getDate()}`;
  return `${d.getFullYear()}/${d.getMonth() + 1}`;
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
  const [timeRange, setTimeRange] = useState<TimeRange>("all");
  const [metric, setMetric] = useState<Metric>("tps");
  const [lastUpdated, setLastUpdated] = useState("");

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
      // 默认全选所有出现过数据的 (provider, model) 对（含失败）
      setSelectedKeys((prev) => {
        if (prev.size > 0) return prev;
        return new Set(sorted.map((t) => recordKey(t)));
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
    const keys = new Set(allTests.map((t) => recordKey(t)));
    return [...keys].sort((a, b) => {
      const [pa, ma] = a.split("|");
      const [pb, mb] = b.split("|");
      return pa.localeCompare(pb) || ma.localeCompare(mb);
    });
  }, [allTests]);

  const pairIndex = useMemo(() => {
    const m = new Map<string, number>();
    pairKeys.forEach((k, i) => m.set(k, i));
    return m;
  }, [pairKeys]);

  const pairColor = useCallbackKeyColor(pairIndex);

  // 对 → 展示名：优先从 allTests 找一条该对记录取完整 provider 信息
  const labelForPair = useMemo(() => {
    const repByKey = new Map<string, TestHistory>();
    for (const t of allTests) {
      const k = recordKey(t);
      if (!repByKey.has(k)) repByKey.set(k, t);
    }
    return (key: string) => {
      const rep = repByKey.get(key);
      if (rep) return modelDisplayLabel(providers, rep);
      const [pid, model] = key.split("|");
      return modelDisplayLabel(providers, { model, provider_id: pid });
    };
  }, [allTests, providers]);

  // 选择器分组：目录 provider + 幽灵组（历史记录里不在目录的 provider）
  const groups: ModelGroup[] = useMemo(() => {
    const result: ModelGroup[] = providers.map((p) => ({ id: p.id, name: p.name, models: p.models || [] }));
    const existing = new Set(result.map((g) => g.id));
    const ghostByKey = new Map<string, { models: string[]; rep: TestHistory }>();
    allTests.forEach((t) => {
      const pk = recordProviderKey(t);
      if (existing.has(pk)) return;
      if (!ghostByKey.has(pk)) ghostByKey.set(pk, { models: [], rep: t });
      const entry = ghostByKey.get(pk)!;
      if (!entry.models.includes(t.model)) entry.models.push(t.model);
    });
    for (const [pk, { models, rep }] of ghostByKey) {
      result.push({
        id: pk,
        name: resolveProviderName(providers, rep),
        models,
      });
    }
    return result;
  }, [providers, allTests]);

  // 过滤：时间范围 + 选中的对
  const timeFiltered = useMemo(() => {
    if (timeRange === "all") return allTests;
    const now = Date.now();
    const msMap: Record<TimeRange, number> = {
      "1h": 3600000,
      "24h": 86400000,
      "7d": 604800000,
      "30d": 2592000000,
      "all": Infinity,
    };
    const cutoff = now - msMap[timeRange];
    return allTests.filter(t => new Date(t.created_at).getTime() >= cutoff);
  }, [allTests, timeRange]);

  const filteredTests = useMemo(() => {
    // 空选择（用户清空筛选）→ 不展示任何数据；默认全选在 fetchData 里填充
    if (selectedKeys.size === 0) return [];
    return timeFiltered.filter(t => selectedKeys.has(recordKey(t)));
  }, [timeFiltered, selectedKeys]);

  // Stats cards
  const cardStats = useMemo(() => {
    const success = filteredTests.filter(t => t.success);
    const total = filteredTests.length;
    if (total === 0) return null;
    return {
      total,
      successRate: total > 0 ? Math.round((success.length / total) * 100) : 0,
      avgTps: success.length > 0 ? success.reduce((s, t) => s + t.tps, 0) / success.length : 0,
      avgLatency: success.length > 0 ? success.reduce((s, t) => s + t.total_latency_ms, 0) / success.length : 0,
    };
  }, [filteredTests]);

  // 时间序列：按 (provider, model) 对分组
  const timeSeriesByPair = useMemo(() => {
    const byPair: Record<string, { time: number; value: number }[]> = {};
    filteredTests.filter(t => t.success).forEach(t => {
      const v = t[metric];
      if (v === null || v === undefined) return; // TTFT 对 non-stream 为 null，跳过
      const k = recordKey(t);
      if (!byPair[k]) byPair[k] = [];
      byPair[k].push({
        time: new Date(t.created_at).getTime(),
        value: v,
      });
    });
    Object.values(byPair).forEach(arr => arr.sort((a, b) => a.time - b.time));
    return byPair;
  }, [filteredTests, metric]);

  const pairsWithData = Object.keys(timeSeriesByPair);
  const showSmallMultiples = pairsWithData.length > 1;
  const globalMaxValue = Math.max(
    ...Object.values(timeSeriesByPair).flatMap(arr => arr.map(d => d.value)),
    1
  );

  // 模型对比：按对
  const modelComparison = useMemo(() => {
    const byPair: Record<string, { sum: number; count: number }> = {};
    filteredTests.filter(t => t.success).forEach(t => {
      const v = t[metric];
      if (v === null || v === undefined) return; // TTFT 对 non-stream 为 null，跳过
      const k = recordKey(t);
      if (!byPair[k]) byPair[k] = { sum: 0, count: 0 };
      byPair[k].sum += v;
      byPair[k].count += 1;
    });
    return Object.entries(byPair)
      .map(([key, data]) => ({
        key,
        name: labelForPair(key),
        value: data.count > 0 ? Math.round((data.sum / data.count) * 100) / 100 : 0,
        count: data.count,
      }))
      .sort((a, b) => b.value - a.value);
  }, [filteredTests, metric, labelForPair]);

  // 成功率：按对，含失败
  const successRateData = useMemo(() => {
    const byPair: Record<string, { total: number; success: number }> = {};
    filteredTests.forEach(t => {
      const k = recordKey(t);
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
  }, [filteredTests, labelForPair]);

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
          <Activity className="w-4 h-4 text-primary" />
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
            title="筛选模型"
          />
        </div>

        {/* Time range selector */}
        <div className="space-y-1.5">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">时间</span>
          <div className="flex gap-1">
            {(Object.keys(TIME_RANGE_LABELS) as TimeRange[]).map(tr => (
              <button
                key={tr}
                type="button"
                onClick={() => setTimeRange(tr)}
                className="cursor-pointer"
              >
                <Badge
                  variant={timeRange === tr ? "default" : "outline"}
                  className="text-[10px] px-1.5 py-0"
                >
                  {TIME_RANGE_LABELS[tr]}
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

      {/* ── Aggregate Cards ── */}
      {cardStats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <MetricCard label="测试次数" value={cardStats.total} />
          <MetricCard label="成功率" value={`${cardStats.successRate}%`} />
          <MetricCard label="平均 TPS" value={Math.round(cardStats.avgTps * 100) / 100} />
          <MetricCard label="平均延迟" value={`${Math.round(cardStats.avgLatency)}ms`} />
        </div>
      )}

      {/* ── 成功率（含失败样本）── */}
      {successRateData.length > 0 && (
        <>
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-3.5 h-3.5 text-primary" />
            <span className="text-xs font-medium">成功率（成功/全部）</span>
            {timeRange !== "all" && (
              <span className="text-[10px] text-muted-foreground">
                最近 {TIME_RANGE_LABELS[timeRange]}
              </span>
            )}
          </div>
          <Card className="border-0 bg-card/50">
            <CardContent className="p-4">
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
                    tick={{ fill: "oklch(0.708 0 0)", fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "oklch(0.205 0 0)",
                      border: "1px solid oklch(0.269 0 0)",
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
            </CardContent>
          </Card>
        </>
      )}

      {/* ── Model Comparison Bar ── */}
      {modelComparison.length > 0 && (
        <>
          <div className="flex items-center gap-2">
            <BarChart3 className="w-3.5 h-3.5 text-primary" />
            <span className="text-xs font-medium">
              模型对比 — {METRIC_LABELS[metric]}
            </span>
          </div>
          <Card className="border-0 bg-card/50">
            <CardContent className="p-4">
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={modelComparison}>
                  <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.269 0 0)" vertical={false} />
                  <XAxis
                    dataKey="name"
                    stroke="oklch(0.708 0 0)"
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis stroke="oklch(0.708 0 0)" fontSize={11} tickLine={false} axisLine={false} />
                  <Tooltip
                    contentStyle={{
                      background: "oklch(0.205 0 0)",
                      border: "1px solid oklch(0.269 0 0)",
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
              {timeRange !== "all" && ` — 最近 ${TIME_RANGE_LABELS[timeRange]}`}
            </span>
            {timeRange === "all" && pairsWithData.length === 1 && (
              <span className="text-[10px] text-muted-foreground">
                {timeSeriesByPair[pairsWithData[0]].length} 个数据点
              </span>
            )}
          </div>

          {showSmallMultiples ? (
            /* Small Multiples: one chart per pair */
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {pairsWithData.sort().map((key) => {
                const data = timeSeriesByPair[key];
                if (data.length < 2) return null;
                const label = labelForPair(key);
                return (
                  <Card key={key} className="border-0 bg-card/50">
                    <CardContent className="p-3">
                      <p className="text-[11px] font-medium mb-1 truncate" title={label}>
                        {label}
                      </p>
                      <p className="text-[10px] text-muted-foreground -mt-0.5 mb-2">
                        avg {data.reduce((s, d) => s + d.value, 0) / data.length | 0} {METRIC_LABELS[metric]}
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
                            domain={[0, globalMaxValue * 1.1]}
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
                            formatter={(val: number) => [val.toFixed(1), METRIC_LABELS[metric]]}
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
                  <LineChart data={timeSeriesByPair[pairsWithData[0]]}>
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
                    />
                    <Tooltip
                      contentStyle={{
                        background: "oklch(0.205 0 0)",
                        border: "1px solid oklch(0.269 0 0)",
                        borderRadius: "8px",
                        fontSize: "12px",
                      }}
                      labelFormatter={(ts: number) => new Date(ts).toLocaleString()}
                      formatter={(val: number) => [val.toFixed(2), METRIC_LABELS[metric]]}
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
                        timeSeriesByPair[pairsWithData[0]].reduce((s, d) => s + d.value, 0) /
                        timeSeriesByPair[pairsWithData[0]].length
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
