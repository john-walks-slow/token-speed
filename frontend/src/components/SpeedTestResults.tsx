import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { Provider, SpeedTestResult, BatchSummary } from "@/types";
import { modelDisplayLabel } from "@/lib/modelLabel";
import ResponseContentView from "@/components/ResponseContentView";
import {
  Gauge,
  Clock,
  CheckCircle2,
  XCircle,
  BarChart3,
  Trophy,
  Brain,
} from "lucide-react";

interface Props {
  results: SpeedTestResult[];
  summary?: BatchSummary;
  providers: Provider[];
}

function MetricCard({
  icon,
  label,
  value,
  unit,
  color = "text-primary",
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  unit?: string;
  color?: string;
}) {
  return (
    <Card className="border-0 bg-card/50 backdrop-blur">
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className={`mt-0.5 ${color}`}>{icon}</div>
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="text-xl font-semibold tabular-nums mt-0.5">
              {value}
              {unit && <span className="text-sm font-normal text-muted-foreground ml-1">{unit}</span>}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function SpeedTestResults({ results, summary, providers }: Props) {
  if (results.length === 0) return null;

  const successResults = results.filter((r) => r.success);
  const bestResult = successResults.find((r) => r.model === summary?.best_model);

  if (summary) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-primary" />
          <span className="text-sm font-medium">测试汇总</span>
          <Badge variant="secondary" className="text-xs">
            {summary.total_tests} 次
          </Badge>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <MetricCard
            icon={<Gauge className="w-4 h-4" />}
            label="平均 TPS"
            value={summary.avg_tps}
            color="text-primary"
          />
          <MetricCard
            icon={<Clock className="w-4 h-4" />}
            label="平均延迟"
            value={summary.avg_latency_ms}
            unit="ms"
            color="text-blue-400"
          />
          <MetricCard
            icon={<Trophy className="w-4 h-4" />}
            label="最佳模型"
            value={bestResult ? modelDisplayLabel(providers, bestResult) : summary.best_model}
            unit={`${summary.best_tps} TPS`}
            color="text-emerald-400"
          />
        </div>

        <div className="space-y-1.5">
          <span className="text-xs text-muted-foreground">各模型详情</span>
          {results
            .filter((r) => r.success)
            .map((r) => (
              <Card key={r.id} className="border-0 bg-card/30">
                <CardContent className="p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-sm font-medium truncate">
                        {modelDisplayLabel(providers, r)}
                      </span>
                      {r.actual_model && r.actual_model !== r.model && (
                        <Badge variant="outline" className="text-[10px] px-1.5 text-amber-400 border-amber-400/30">
                          实际: {r.actual_model.split("/").pop()}
                        </Badge>
                      )}
                      <Badge variant="success" className="text-[10px] px-1.5">
                        {r.tps} TPS
                      </Badge>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground shrink-0">
                      <ResponseContentView content={r.response_content} />
                      <span>延迟 {r.total_latency_ms}ms</span>
                      <span>
                        TTFT {r.ttft_ms !== null ? `${r.ttft_ms}ms` : "N/A"}
                      </span>
                      {r.reasoning_tokens > 0 && (
                        <span className="text-purple-400" title="reasoning / content tokens">
                          <Brain className="w-3 h-3 inline mr-0.5" />
                          {r.reasoning_tokens}+{r.content_tokens}
                        </span>
                      )}
                      <span>{r.tokens_generated} tokens</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
        </div>
      </div>
    );
  }

  // Single test result
  const r = results[0];
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        {r.success ? (
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
        ) : (
          <XCircle className="w-4 h-4 text-destructive" />
        )}
        <span className="text-sm font-medium">
          {modelDisplayLabel(providers, r)} — {r.success ? "成功" : "失败"}
        </span>
        {r.success && r.actual_model && r.actual_model !== r.model && (
          <Badge variant="outline" className="text-[10px] px-1.5 text-amber-400 border-amber-400/30">
            实际模型: {r.actual_model.split("/").pop()}
          </Badge>
        )}
      </div>

      {r.success ? (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <MetricCard
              icon={<Gauge className="w-4 h-4" />}
              label="TPS"
              value={r.tps}
              color="text-primary"
            />
            <MetricCard
              icon={<Clock className="w-4 h-4" />}
              label="总延迟"
              value={r.total_latency_ms}
              unit="ms"
              color="text-blue-400"
            />
            <MetricCard
              icon={<Clock className="w-4 h-4" />}
              label="TTFT"
              value={r.ttft_ms ?? "N/A"}
              unit={r.ttft_ms !== null ? "ms" : ""}
              color="text-purple-400"
            />
          </div>

          {(r.reasoning_tokens > 0 || r.content_ttft_ms !== null) && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {r.reasoning_tokens > 0 && (
                <>
                  <MetricCard
                    icon={<Brain className="w-4 h-4" />}
                    label="推理 Tokens"
                    value={r.reasoning_tokens}
                    color="text-purple-400"
                  />
                  <MetricCard
                    icon={<Gauge className="w-4 h-4" />}
                    label="内容 Tokens"
                    value={r.content_tokens}
                    color="text-emerald-400"
                  />
                </>
              )}
              {r.content_ttft_ms !== null && (
                <MetricCard
                  icon={<Clock className="w-4 h-4" />}
                  label="内容 TTFT"
                  value={r.content_ttft_ms}
                  unit="ms"
                  color="text-blue-400"
                />
              )}
            </div>
          )}
        </>
      ) : (
        <p className="text-sm text-destructive">{r.error_message}</p>
      )}
    </div>
  );

}
