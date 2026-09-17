import { Badge } from "@/components/ui/badge";
import type { Provider, SpeedTestResult } from "@/types";
import { modelDisplayLabel } from "@/lib/modelLabel";
import ResponseContentView from "@/components/ResponseContentView";
import FailureInfo from "@/components/FailureInfo";

interface Props {
  result: SpeedTestResult;
  providers: Provider[];
}

/** 单条测速结果行：成功显示指标，失败显示错误。进度面板与本次测速结果共用，保证展示一致。 */
export default function ResultRow({ result: r, providers }: Props) {
  // 整体请求失败时后端不返回 item，前端构造的兜底行 model 为 "error"
  const label = r.model === "error" ? "测速失败" : modelDisplayLabel(providers, r);

  return (
    <div className="flex items-center justify-between gap-2 px-3 py-1.5 rounded-md bg-card/60 text-sm">
      <div className="flex items-center gap-2 min-w-0">
        {r.success ? (
          <Badge
            variant="success"
            className="text-[10px] px-1.5 shrink-0"
            title="有效速度 = 产出 token / 请求总耗时（含思考和等待）"
          >
            {r.tps !== null ? `${r.tps} tok/s` : "N/A"}
          </Badge>
        ) : null}
        <span className="truncate font-medium">{label}</span>
        {r.actual_model && r.actual_model !== r.model && (
          <Badge variant="outline" className="text-[10px] px-1.5 text-amber-400 border-amber-400/30 shrink-0">
            实际: {r.actual_model.split("/").pop()}
          </Badge>
        )}
      </div>
      <div className="flex items-center gap-3 text-xs text-muted-foreground shrink-0 tabular-nums">
        {r.success ? (
          <>
            <ResponseContentView content={r.response_content} />
            <span>{r.total_latency_ms}ms</span>
            <span>TTFT {r.ttft_ms !== null ? `${r.ttft_ms}ms` : "N/A"}</span>
            {r.reasoning_tokens > 0 && (
              <span className="text-purple-400" title="reasoning / content tokens">
                {r.reasoning_tokens}+{r.content_tokens}
              </span>
            )}
            {r.thinking_ms !== null && r.thinking_ms > 0 && (
              <span title="思考耗时">思考 {r.thinking_ms}ms</span>
            )}
            <span title={`输入 ${r.input_tokens ?? "?"} / 输出 ${r.tokens_generated} tokens`}>
              ↑{r.input_tokens ?? "?"} ↓{r.tokens_generated}
            </span>
          </>
        ) : (
          <div className="flex-1 flex justify-end min-w-0">
            <FailureInfo message={r.error_message} />
          </div>
        )}
      </div>
    </div>
  );
}
