import { useState, useEffect, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  CalendarClock,
  Pause,
  Play,
  Trash2,
  Pencil,
  Zap,
  Loader2,
  Clock,
  RefreshCw,
} from "lucide-react";
import {
  getSchedules,
  deleteSchedule,
  toggleSchedule,
  runScheduleNow,
} from "@/lib/api";
import type { Schedule } from "@/types";

const POLL_MS = 30000; // 对齐调度器 30s tick

interface Props {
  refreshKey: number;
  onEdit: (schedule: Schedule) => void;
}

function formatTime(iso?: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatDate(iso?: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString([], {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusBadge(s: Schedule) {
  const { run_done = 0, run_total = 0, run_success = 0 } = s;
  switch (s.last_run_status) {
    case "success":
      return run_total > 0
        ? <Badge variant="success" className="text-[10px]">{run_success}/{run_total} 成功</Badge>
        : <Badge variant="success" className="text-[10px]">成功</Badge>;
    case "partial":
      return run_total > 0
        ? <Badge variant="warning" className="text-[10px]">{run_success}/{run_total} 成功</Badge>
        : <Badge variant="warning" className="text-[10px]">部分成功</Badge>;
    case "failed":
      return run_total > 0
        ? <Badge variant="destructive" className="text-[10px]">{run_success}/{run_total} 成功</Badge>
        : <Badge variant="destructive" className="text-[10px]">失败</Badge>;
    case "running":
      return run_total > 0
        ? <Badge variant="secondary" className="text-[10px]">执行中 {run_done}/{run_total}</Badge>
        : <Badge variant="secondary" className="text-[10px]">执行中</Badge>;
    default:
      return <span className="text-[10px] text-muted-foreground">未执行</span>;
  }
}

export default function ScheduleList({ refreshKey, onEdit }: Props) {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionError, setActionError] = useState<string | null>(null);

  const fetchSchedules = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const data = await getSchedules();
      setSchedules(data);
      setActionError(null);
    } catch {
      // 静默：轮询失败不打扰
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSchedules();
  }, [fetchSchedules, refreshKey]);

  // 30s 自动轮询（仅在 Tab 激活时运行；组件卸载即停止）
  useEffect(() => {
    const timer = setInterval(() => fetchSchedules(true), POLL_MS);
    return () => clearInterval(timer);
  }, [fetchSchedules]);

  const handleToggle = async (s: Schedule) => {
    try {
      await toggleSchedule(s.id, !s.enabled);
      await fetchSchedules(true);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "操作失败");
    }
  };

  const handleRunNow = async (s: Schedule) => {
    try {
      await runScheduleNow(s.id);
      await fetchSchedules(true);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "手动触发失败");
    }
  };

  const handleDelete = async (s: Schedule) => {
    if (!confirm(`确定删除定时任务「${s.name || "未命名"}」？历史记录会保留`)) return;
    try {
      await deleteSchedule(s.id);
      setSchedules((prev) => prev.filter((x) => x.id !== s.id));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "删除失败");
    }
  };

  if (loading && schedules.length === 0) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (schedules.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-12">
        还没有定时任务，点击右上角「新建」创建第一个
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {actionError && (
        <p className="text-xs text-destructive">{actionError}</p>
      )}
      {schedules.map((s) => {
        const isRunning = s.last_run_status === "running";
        const modelSummary = s.targets
          .flatMap((t) => t.models)
          .map((m) => m.split("/").pop())
          .join(" · ");
        return (
          <Card key={s.id} className="border-0 bg-card/30">
            <CardContent className="p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <CalendarClock className="w-4 h-4 text-primary shrink-0" />
                  <span className="text-sm font-medium truncate">
                    {s.name || "未命名任务"}
                  </span>
                  {s.enabled ? (
                    <Badge variant="secondary" className="text-[10px]">已启用</Badge>
                  ) : (
                    <Badge variant="outline" className="text-[10px]">已暂停</Badge>
                  )}
                  {statusBadge(s)}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2"
                    onClick={() => onEdit(s)}
                    title="编辑"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2"
                    onClick={() => handleToggle(s)}
                    title={s.enabled ? "暂停" : "恢复"}
                  >
                    {s.enabled ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2"
                    onClick={() => handleRunNow(s)}
                    disabled={isRunning}
                    title={isRunning ? "执行中" : "立即执行"}
                  >
                    <Zap className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-muted-foreground hover:text-destructive"
                    onClick={() => handleDelete(s)}
                    title="删除"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>

              {modelSummary && (
                <p className="text-xs text-muted-foreground truncate">{modelSummary}</p>
              )}

              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <RefreshCw className="w-3 h-3" />
                  每 {s.interval_minutes} 分钟
                </span>
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {isRunning ? (
                    <span className="text-foreground">执行中…</span>
                  ) : (
                    <>下次 {formatDate(s.next_run_at)}</>
                  )}
                </span>
                <span>
                  上次 {formatTime(s.last_run_at)}
                </span>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
