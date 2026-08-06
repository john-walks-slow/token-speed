import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getHistory, deleteHistoryItem, clearHistory } from "@/lib/api";
import type { TestHistory } from "@/types";
import { History, Trash2, X, CheckCircle2, XCircle, Loader2 } from "lucide-react";

interface Props {
  refreshKey: number;
}

export default function HistoryList({ refreshKey }: Props) {
  const [tests, setTests] = useState<TestHistory[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchHistory = async () => {
    setLoading(true);
    try {
      const data = await getHistory(100);
      setTests(data);
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
            {tests.length}
          </Badge>
        </div>
        {tests.length > 0 && (
          <Button variant="ghost" size="sm" onClick={handleClear}>
            <Trash2 className="w-3.5 h-3.5" />
            清空
          </Button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : tests.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">
          暂无测速记录
        </p>
      ) : (
        <div className="space-y-1.5 max-h-96 overflow-y-auto">
          {tests.map((t) => (
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
                      {t.model.split("/").pop()}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {new Date(t.created_at).toLocaleTimeString()}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground shrink-0">
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
