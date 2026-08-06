import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, Play, FlaskConical } from "lucide-react";

interface Props {
  selectedCount: number;
  providerCount: number;
  onRunTest: (params: {
    prompt: string;
    maxTokens: number;
    temperature: number;
    concurrency: number;
    iterations: number;
    stream: boolean;
  }) => void;
  running: boolean;
}

export default function SpeedTestForm({ selectedCount, providerCount, onRunTest, running }: Props) {
  const [prompt, setPrompt] = useState("Hello, tell me a short story in 3 sentences.");
  const [maxTokens, setMaxTokens] = useState(128);
  const [temperature, setTemperature] = useState(0.7);
  const [concurrency, setConcurrency] = useState(1);
  const [iterations, setIterations] = useState(1);
  const [stream, setStream] = useState(true);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedCount === 0 || running) return;
    onRunTest({
      prompt,
      maxTokens,
      temperature,
      concurrency,
      iterations,
      stream,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 border-t border-border/30 pt-4">
      <div className="space-y-2">
        <label className="text-sm font-medium flex items-center gap-1.5">
          <FlaskConical className="w-3.5 h-3.5 text-muted-foreground" />
          Prompt
        </label>
        <textarea
          className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none"
          rows={2}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground">Max Tokens</label>
          <Input type="number" min={1} max={4096} value={maxTokens} onChange={(e) => setMaxTokens(Number(e.target.value))} />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground">Temperature</label>
          <Input type="number" min={0} max={2} step={0.1} value={temperature} onChange={(e) => setTemperature(Number(e.target.value))} />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground">并发数</label>
          <Input type="number" min={1} max={20} value={concurrency} onChange={(e) => setConcurrency(Number(e.target.value))} />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground">迭代次数</label>
          <Input type="number" min={1} max={20} value={iterations} onChange={(e) => setIterations(Number(e.target.value))} />
        </div>
      </div>

      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={stream} onChange={(e) => setStream(e.target.checked)} className="rounded border-input text-primary focus:ring-ring" />
          <span className="text-sm text-muted-foreground">Streaming 模式</span>
        </label>

        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {selectedCount} 模型 · {providerCount} 服务商 × {iterations} 次 = {selectedCount * iterations} 测试
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
      </div>
    </form>
  );
}
