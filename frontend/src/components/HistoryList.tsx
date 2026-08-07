import { useState, useEffect, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getHistory, deleteHistoryItem, clearHistory, getSchedules } from "@/lib/api";
import type { Provider, TestHistory } from "@/types";
import { modelDisplayLabel } from "@/lib/modelLabel";
import ResponseContentView from "@/components/ResponseContentView";
import { History, Trash2, X, CheckCircle2, XCircle, Loader2 } from "lucide-react";

type TimeRange = "today" | "7d" | "30d" | "all";

const TIME_RANGE_LABELS: Record<TimeRange, string> = {
  today: "今天",
  "7d": "近7天",
  "30d": "近30天",
  all: "全部",
};

interface Props {
  refreshKey: number;
  providers: Provider[];
}

export default function HistoryList({ refreshKey, providers }: Props) {
  const [tests, setTests] = useState<TestHistory[]>([]);
  const [scheduleNames, setScheduleNames] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [timeRange, setTimeRange] = useState<TimeRange>("all");

  const fetchHistory = async () => {
    setLoading(true);
    try {
      const [data, schedules] = await Promise.all([getHistory(500), getSchedules()]);
      setTests(data);
      setScheduleNames(new Map(schedules.map((s) => [s.id, s.name || "定时"])));
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHistory();
  }, [refreshKey]);

  const handleDelete = async (id: string) => {
    await deleteHistoryItem(id);
    setTests((prev) => prev.filter((t) => t.id !== id));
  };

  const filteredTests = useMemo(() => {
    if (timeRange === "all") return tests;
    const now = Date.now();
    const msMap: Record<TimeRange, number> = {
      today: 86400000,
      "7d": 7 * 86400000,
      "30d": 30 * 86400000,
      all: Infinity,
    };
    // "今天" 按自然日过滤，其余按滚动时间窗口
    if (timeRange === "today") {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      return tests.filter((t) => new Date(t.created_at).getTime() >= startOfDay.getTime());
    }
    const cutoff = now - msMap[timeRange];
    return tests.filter((t) => new Date(t.created_at).getTime() >= cutoff);
  }, [tests, timeRange]);

  const handleClear = async () => {
    if (!confirm("确定清空所有历史记录？")) return;
    await clearHistory();
    setTests([]);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <History className="w-4 h-4 text-primary" />
          <span className="text-sm font-medium">测速历史</span>
          <Badge variant="secondary" className="text-xs">
            {filteredTests.length}
          </Badge>
        </div>
        {tests.length > 0 && (
          <Button variant="ghost" size="sm" onClick={handleClear}>
            <Trash2 className="w-3.5 h-3.5" />
            清空
          </Button>
        )}
      </div>

      {/* 日期过滤 */}
      {tests.length > 0 && (
        <div className="flex gap-1">
          {(Object.keys(TIME_RANGE_LABELS) as TimeRange[]).map((tr) => (
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
      )}

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : filteredTests.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">
          {tests.length === 0 ? "暂无测速记录" : "当前时间范围内没有记录"}
        </p>
      ) : (
        <div className="space-y-1.5 max-h-96 overflow-y-auto">
          {filteredTests.map((t) => (
            <Card key={t.id} className="border-0 bg-card/30 group">
              <CardContent className="p-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    {t.success ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    ) : (
                      <XCircle className="w-3.5 h-3.5 text-destructive shrink-0" />
                    )}
                    <span className="text-sm truncate">
                      {modelDisplayLabel(providers, t)}
                    </span>
                    {t.schedule_id && (
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0">
                        {scheduleNames.get(t.schedule_id) || "定时"}
                      </Badge>
                    )}
                    <span className="text-xs text-muted-foreground">
                      {new Date(t.created_at).toLocaleTimeString()}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground shrink-0">
                    <ResponseContentView content={t.response_content} />
                    <span className="tabular-nums">{t.tps} TPS</span>
                    <span className="tabular-nums">{t.total_latency_ms}ms</span>
                    <button
                      title="删除"
                      onClick={() => handleDelete(t.id)}
                      className="text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer p-0.5"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
