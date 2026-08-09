import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { XCircle } from "lucide-react";
import type { Provider, SpeedTestResult } from "@/types";
import { modelDisplayLabel } from "@/lib/modelLabel";
import ResponseContentView from "@/components/ResponseContentView";
import ErrorMessageView from "@/components/ErrorMessageView";

interface Props {
  completed: number;
  total: number;
  results: SpeedTestResult[];
  cancelled: boolean;
  onCancel: () => void;
  providers: Provider[];
}

export default function SpeedTestProgress({ completed, total, results, cancelled, onCancel, providers }: Props) {
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
              <div
                key={r.id}
                className="flex items-center justify-between gap-2 px-3 py-1.5 rounded-md bg-card/60 text-sm"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="truncate font-medium">{modelDisplayLabel(providers, r)}</span>
                  <Badge
                    variant={r.success ? "success" : "destructive"}
                    className="text-[10px] px-1.5"
                  >
                    {r.success ? "成功" : "失败"}
                  </Badge>
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground shrink-0 tabular-nums">
                  <ResponseContentView content={r.response_content} />
                  {r.success ? (
                    <>
                      <span>{r.tps !== null ? `${r.tps} tok/s` : "N/A"}</span>
                      <span>{r.total_latency_ms}ms</span>
                    </>
                  ) : (
                    <span className="flex items-center gap-1.5 text-destructive/80">
                      <span className="max-w-40 truncate">
                        {r.error_message || "失败"}
                      </span>
                      <ErrorMessageView message={r.error_message} />
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
