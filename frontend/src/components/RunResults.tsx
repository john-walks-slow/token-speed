import { Badge } from "@/components/ui/badge";
import type { Provider, SpeedTestResult } from "@/types";
import ResultRow from "@/components/ResultRow";

interface Props {
  results: SpeedTestResult[];
  providers: Provider[];
}

/** 本次测速的逐条结果（含失败）。聚合统计见统计页。 */
export default function RunResults({ results, providers }: Props) {
  if (results.length === 0) return null;

  return (
    <div className="space-y-1.5 border-t border-border/30 pt-4">
      <div className="flex items-center gap-2 pb-1">
        <span className="text-sm font-medium">本次测速结果</span>
        <Badge variant="secondary" className="text-xs">
          {results.length} 条
        </Badge>
      </div>

      {results.map((r) => (
        <ResultRow key={r.id} result={r} providers={providers} />
      ))}
    </div>
  );
}
