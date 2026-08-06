import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Play } from "lucide-react";
import TestParamsFields, { DEFAULT_PARAMS, type TestParamsValues } from "@/components/TestParamsFields";

interface Props {
  selectedCount: number;
  providerCount: number;
  onRunTest: (params: TestParamsValues) => void;
  running: boolean;
}

export default function SpeedTestForm({ selectedCount, providerCount, onRunTest, running }: Props) {
  const [params, setParams] = useState<TestParamsValues>(DEFAULT_PARAMS);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedCount === 0 || running) return;
    onRunTest(params);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 border-t border-border/30 pt-4">
      <TestParamsFields values={params} onChange={setParams} />

      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {selectedCount} 模型 · {providerCount} 服务商 × {params.iterations} 次 = {selectedCount * params.iterations} 测试
        </span>
        <Button type="submit" disabled={selectedCount === 0 || running}>
          {running ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              测试中...
            </>
          ) : (
            <>
              <Play className="w-4 h-4" />
              开始测速
            </>
          )}
        </Button>
      </div>
    </form>
  );
}
