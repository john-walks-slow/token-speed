import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { XCircle } from "lucide-react";
import type { Provider, SpeedTestResult } from "@/types";
import ResultRow from "@/components/ResultRow";

interface Props {
  completed: number;
  total: number;
  results: SpeedTestResult[];
  cancelled: boolean;
  onCancel: () => void;
  /** 收起进度面板并展示本次已完成的结果。取消/失败时可用。 */
  onShowResults: () => void;
  providers: Provider[];
}

export default function SpeedTestProgress({ completed, total, results, cancelled, onCancel, onShowResults, providers }: Props) {
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <Card className="border-0 bg-card/50 backdrop-blur">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            {cancelled ? (
              <XCircle className="w-4 h-4 text-amber-400" />
            ) : (
              <span className="inline-block w-4 h-4 rounded-full border-2 border-primary border-t-transparent animate-spin" />
            )}
            {cancelled ? "测速已取消" : "测速中"}
            <span className="text-xs text-muted-foreground font-normal tabular-nums">
              {completed}/{total}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground tabular-nums">{pct}%</span>
            {cancelled && results.length > 0 && (
              <Button type="button" variant="ghost" size="sm" onClick={onShowResults}>
                查看结果
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={onCancel}
              disabled={cancelled}
            >
              {cancelled ? "已取消" : "取消"}
            </Button>
          </div>
        </div>

        <div className="h-2 rounded-full bg-primary/10 overflow-hidden">
          <div
            className="h-full bg-primary transition-all duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>

        {results.length > 0 && (
          <div className="space-y-1.5 max-h-64 overflow-y-auto">
            {results.map((r) => (
              <ResultRow key={r.id} result={r} providers={providers} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
