import { Input } from "@/components/ui/input";
import { FlaskConical } from "lucide-react";

export interface TestParamsValues {
  prompt: string;
  maxTokens: number;
  temperature: number;
  concurrency: number;
  iterations: number;
  stream: boolean;
}

export const DEFAULT_PARAMS: TestParamsValues = {
  prompt: "Hello, tell me a short story in 3 sentences.",
  maxTokens: 256,
  temperature: 0.7,
  concurrency: 1,
  iterations: 1,
  stream: true,
};

interface Props {
  values: TestParamsValues;
  onChange: (values: TestParamsValues) => void;
}

/** 测速参数输入组，SpeedTestForm 与 ScheduleForm 共用。受控组件。 */
export default function TestParamsFields({ values, onChange }: Props) {
  const set = (patch: Partial<TestParamsValues>) => onChange({ ...values, ...patch });

  return (
    <>
      <div className="space-y-2">
        <label className="text-sm font-medium flex items-center gap-1.5">
          <FlaskConical className="w-3.5 h-3.5 text-muted-foreground" />
          Prompt
        </label>
        <textarea
          className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none"
          rows={2}
          value={values.prompt}
          onChange={(e) => set({ prompt: e.target.value })}
        />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground">Max Tokens</label>
          <Input type="number" min={1} max={4096} value={values.maxTokens} onChange={(e) => set({ maxTokens: Number(e.target.value) })} />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground">Temperature</label>
          <Input type="number" min={0} max={2} step={0.1} value={values.temperature} onChange={(e) => set({ temperature: Number(e.target.value) })} />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground">并发数</label>
          <Input type="number" min={1} max={20} value={values.concurrency} onChange={(e) => set({ concurrency: Number(e.target.value) })} />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground">迭代次数</label>
          <Input type="number" min={1} max={20} value={values.iterations} onChange={(e) => set({ iterations: Number(e.target.value) })} />
        </div>
      </div>

      <label className="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" checked={values.stream} onChange={(e) => set({ stream: e.target.checked })} className="rounded border-input text-primary focus:ring-ring" />
        <span className="text-sm text-muted-foreground">Streaming 模式</span>
      </label>
    </>
  );
}
