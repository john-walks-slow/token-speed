import { useState, useEffect, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getHistory, deleteHistoryItem, clearHistory, getSchedules } from "@/lib/api";
import type { Provider, TestHistory } from "@/types";
import { modelDisplayLabel } from "@/lib/modelLabel";
import ResponseContentView from "@/components/ResponseContentView";
import ErrorMessageView from "@/components/ErrorMessageView";
import TimeRangeFilter from "@/components/TimeRangeFilter";
import { filterTestsByRange, type TimeRangeValue } from "@/lib/timeRange";
import { Trash2, X, CheckCircle2, XCircle, Loader2 } from "lucide-react";

interface Props {
  refreshKey: number;
  providers: Provider[];
  /** 只读模式（独立看板）：隐藏删除/清空操作。 */
  readOnly?: boolean;
}

export default function HistoryList({ refreshKey, providers, readOnly = false }: Props) {
  const [tests, setTests] = useState<TestHistory[]>([]);
  const [scheduleNames, setScheduleNames] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [timeRange, setTimeRange] = useState<TimeRangeValue>({ type: "preset", key: "all" });

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

  const filteredTests = useMemo(
    () => filterTestsByRange(tests, timeRange),
    [tests, timeRange]
  );

  const handleClear = async () => {
    if (!confirm("确定清空所有历史记录？")) return;
    await clearHistory();
    setTests([]);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">测速历史</span>
          <Badge variant="secondary" className="text-xs">
            {filteredTests.length}
          </Badge>
        </div>
        {!readOnly && (
          <Button variant="ghost" size="sm" onClick={handleClear} disabled={tests.length === 0}>
            <Trash2 className="w-3.5 h-3.5" />
            清空
          </Button>
        )}
      </div>

      {/* 日期过滤 */}
      <TimeRangeFilter
        value={timeRange}
        onChange={setTimeRange}
        presets={["1h", "8h", "24h", "7d", "all"]}
      />

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : filteredTests.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">
          {tests.length === 0 ? "暂无测速记录" : "当前时间范围内没有记录"}
        </p>
      ) : (
        <div className="space-y-1.5">
          {filteredTests.map((t) => (
            <Card key={t.id} className="border-0 bg-card/30 group">
              <CardContent className="p-3 space-y-2">
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
                  <div className="flex items-center gap-1 shrink-0">
                    {!t.success && <ErrorMessageView message={t.error_message} />}
                    {!readOnly && (
                      <button
                        title="删除"
                        onClick={() => handleDelete(t.id)}
                        className="text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer p-0.5"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>

                {t.success && (
                  <div className="flex items-center gap-3 text-xs text-muted-foreground tabular-nums border-t border-border/20 pt-2">
                    <ResponseContentView content={t.response_content} />
                    <span>TTFT {t.ttft_ms !== null ? `${t.ttft_ms}ms` : "N/A"}</span>
                    <span>{t.total_latency_ms}ms</span>
                    <span title="有效速度 = 产出 token / 请求总耗时（含思考和等待）">
                      {t.tps !== null ? `${t.tps} tok/s` : "N/A"}
                    </span>
                    {t.reasoning_tokens > 0 ? (
                      <span className="text-purple-400" title="reasoning / content tokens">
                        {t.reasoning_tokens}+{t.content_tokens}
                      </span>
                    ) : (
                      <span title="output tokens">{t.content_tokens} tokens</span>
                    )}
                    {t.thinking_ms !== null && t.thinking_ms > 0 && (
                      <span title="思考耗时">思考 {t.thinking_ms}ms</span>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
