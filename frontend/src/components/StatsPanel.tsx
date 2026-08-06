import { useState, useEffect, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getHistory, getStats } from "@/lib/api";
import type { TestHistory, StatsResponse } from "@/types";
import {
  BarChart3,
  TrendingUp,
  Gauge,
  Zap,
  Clock,
  Activity,
  Loader2,
  RotateCcw,
} from "lucide-react";
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
} from "recharts";

type Metric = "tps" | "tpm" | "total_latency_ms" | "ttft_ms";
type TimeRange = "1h" | "24h" | "7d" | "30d" | "all";

const METRIC_LABELS: Record<Metric, string> = {
  tps: "TPS",
  tpm: "TPM",
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
}

export default function StatsPanel({ refreshKey }: Props) {
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [allTests, setAllTests] = useState<TestHistory[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  const [timeRange, setTimeRange] = useState<TimeRange>("all");
  const [metric, setMetric] = useState<Metric>("tps");
  const [lastUpdated, setLastUpdated] = useState("");

  const fetchData = async () => {
    setLoading(true);
    try {
      const [s, h] = await Promise.all([getStats(), getHistory(200, 0)]);
      setStats(s);
      // Ensure data has proper time objects
      const sorted = [...h].sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );
      setAllTests(sorted);
      // Auto-select all models that have data
      const uniqueModels = [...new Set(sorted.filter(t => t.success).map(t => t.model))];
      if (selectedModels.length === 0 && uniqueModels.length > 0) {
        setSelectedModels(uniqueModels);
      }
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

  // ── Derived data ──────────────────────────────────────────

  const allModelNames = useMemo(
    () => [...new Set(allTests.filter(t => t.success).map(t => t.model))],
    [allTests]
  );

  // Filter by time range
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

  // Filter by selected models
  const filteredTests = useMemo(() => {
    if (selectedModels.length === 0) return timeFiltered;
    return timeFiltered.filter(t => selectedModels.includes(t.model));
  }, [timeFiltered, selectedModels]);

  // Stats cards
  const cardStats = useMemo(() => {
    const success = filteredTests.filter(t => t.success);
    const total = filteredTests.length;
    if (total === 0) return null;
    return {
      total,
      successRate: total > 0 ? Math.round((success.length / total) * 100) : 0,
      avgTps: success.length > 0 ? success.reduce((s, t) => s + t.tps, 0) / success.length : 0,
      avgTpm: success.length > 0 ? success.reduce((s, t) => s + t.tpm, 0) / success.length : 0,
      avgLatency: success.length > 0 ? success.reduce((s, t) => s + t.total_latency_ms, 0) / success.length : 0,
    };
  }, [filteredTests]);

  // Time-series data: group by model
  const timeSeriesByModel = useMemo(() => {
    const byModel: Record<string, { time: number; value: number }[]> = {};
    filteredTests.filter(t => t.success).forEach(t => {
      if (!byModel[t.model]) byModel[t.model] = [];
      byModel[t.model].push({
        time: new Date(t.created_at).getTime(),
        value: t[metric],
      });
    });
    // Sort each model's data by time
    Object.values(byModel).forEach(arr => arr.sort((a, b) => a.time - b.time));
    return byModel;
  }, [filteredTests, metric]);

  const modelsWithData = Object.keys(timeSeriesByModel);
  const showSmallMultiples = modelsWithData.length > 1;
  const globalMaxValue = Math.max(
    ...Object.values(timeSeriesByModel).flatMap(arr => arr.map(d => d.value)),
    1
  );

  // Model comparison data
  const modelComparison = useMemo(() => {
    const byModel: Record<string, { sum: number; count: number }> = {};
    filteredTests.filter(t => t.success).forEach(t => {
      if (!byModel[t.model]) byModel[t.model] = { sum: 0, count: 0 };
      byModel[t.model].sum += t[metric];
      byModel[t.model].count += 1;
    });
    return Object.entries(byModel)
      .map(([model, data]) => ({
        name: model.split("/").pop() || model,
        value: data.count > 0 ? Math.round((data.sum / data.count) * 100) / 100 : 0,
        count: data.count,
      }))
      .sort((a, b) => b.value - a.value);
  }, [filteredTests, metric]);

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
        {/* Model selector */}
        <div className="space-y-1.5">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">模型</span>
          <div className="flex flex-wrap gap-1">
            {allModelNames.map((m, i) => {
              const isSelected = selectedModels.includes(m);
              const shortName = m.split("/").pop() || m;
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => {
                    setSelectedModels(prev =>
                      prev.includes(m) ? prev.filter(x => x !== m) : [...prev, m]
                    );
                  }}
                  className="cursor-pointer"
                >
                  <Badge
                    variant={isSelected ? "default" : "outline"}
                    className="text-[10px] px-1.5 py-0"
                    style={isSelected ? { backgroundColor: getModelColor(i) } : {}}
                  >
                    {shortName}
                  </Badge>
                </button>
              );
            })}
          </div>
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
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <MetricCard label="测试次数" value={cardStats.total} />
          <MetricCard label="成功率" value={`${cardStats.successRate}%`} />
          <MetricCard label="平均 TPS" value={Math.round(cardStats.avgTps * 100) / 100} />
          <MetricCard label="平均 TPM" value={Math.round(cardStats.avgTpm * 100) / 100} />
          <MetricCard label="平均延迟" value={`${Math.round(cardStats.avgLatency)}ms`} />
        </div>
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
                    {modelComparison.map((entry, idx) => (
                      <Cell key={entry.name} fill={getModelColor(idx)} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </>
      )}

      {/* ── Time Series ── */}
      {modelsWithData.length > 0 && (
        <>
          <div className="flex items-center gap-2">
            <TrendingUp className="w-3.5 h-3.5 text-primary" />
            <span className="text-xs font-medium">
              {METRIC_LABELS[metric]} 趋势
              {timeRange !== "all" && ` — 最近 ${TIME_RANGE_LABELS[timeRange]}`}
            </span>
            {timeRange === "all" && modelsWithData.length === 1 && (
              <span className="text-[10px] text-muted-foreground">
                {timeSeriesByModel[modelsWithData[0]].length} 个数据点
              </span>
            )}
          </div>

          {showSmallMultiples ? (
            /* Small Multiples: one chart per model */
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {modelsWithData.sort().map((model, idx) => {
                const data = timeSeriesByModel[model];
                if (data.length < 2) return null;
                return (
                  <Card key={model} className="border-0 bg-card/50">
                    <CardContent className="p-3">
                      <p className="text-[11px] font-medium mb-1 truncate" title={model}>
                        {model.split("/").pop()}
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
                            stroke={getModelColor(idx)}
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
            /* Single model: big clean chart */
            <Card className="border-0 bg-card/50">
              <CardContent className="p-4">
                <ResponsiveContainer width="100%" height={240}>
                  <LineChart data={timeSeriesByModel[modelsWithData[0]]}>
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
                      stroke="oklch(0.922 0.176 149.238)"
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 5, strokeWidth: 0 }}
                      connectNulls={false}
                      animationDuration={600}
                    />
                    <ReferenceLine
                      y={
                        timeSeriesByModel[modelsWithData[0]].reduce((s, d) => s + d.value, 0) /
                        timeSeriesByModel[modelsWithData[0]].length
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
