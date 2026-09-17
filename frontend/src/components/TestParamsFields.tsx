import { useEffect } from "react";
import { Input } from "@/components/ui/input";
import { FlaskConical } from "lucide-react";

export interface TestParamsValues {
  prompt: string;
  maxTokens: number | null;
  temperature: number | null;
  concurrency: number;
  iterations: number;
  stream: boolean;
  maxRpm: number;
}

export const DEFAULT_PARAMS: TestParamsValues = {
  prompt: "Hello, tell me a short story in 3 sentences.",
  maxTokens: null,
  temperature: null,
  concurrency: 1,
  iterations: 1,
  stream: true,
  maxRpm: -1,
};

const STORAGE_KEY = "token-speed.test-params.v1";

export function loadSavedParams(): TestParamsValues {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PARAMS;
    return { ...DEFAULT_PARAMS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_PARAMS;
  }
}

function saveParams(values: TestParamsValues) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(values));
  } catch {
    // localStorage 不可用时静默忽略
  }
}

interface Props {
  values: TestParamsValues;
  onChange: (values: TestParamsValues) => void;
  /** 是否持久化到 localStorage。仅手动测速表单启用，定时任务编辑不覆盖已记忆配置。 */
  persist?: boolean;
}

/** 测速参数输入组，SpeedTestForm 与 ScheduleForm 共用。受控组件。
 *
 * persist 时值变化自动持久化到 localStorage，下次打开沿用上次测试配置。
 */
export default function TestParamsFields({ values, onChange, persist = true }: Props) {
  useEffect(() => {
    if (persist) saveParams(values);
  }, [values, persist]);

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
          <Input
            type="number"
            min={1}
            max={4096}
            value={values.maxTokens ?? ""}
            placeholder="默认"
            onChange={(e) => set({ maxTokens: e.target.value === "" ? null : Number(e.target.value) })}
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground">Temperature</label>
          <Input
            type="number"
            min={0}
            max={2}
            step={0.1}
            value={values.temperature ?? ""}
            placeholder="默认"
            onChange={(e) => set({ temperature: e.target.value === "" ? null : Number(e.target.value) })}
          />
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

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={values.stream} onChange={(e) => set({ stream: e.target.checked })} className="rounded border-input text-primary focus:ring-ring" />
          <span className="text-sm text-muted-foreground">Streaming 模式</span>
        </label>

        <div className="flex items-center gap-1.5">
          <label className="text-xs text-muted-foreground">每分钟最大请求</label>
          <Input
            type="number"
            min={-1}
            value={values.maxRpm}
            title="按服务商分别限速，-1 表示不限速"
            onChange={(e) => set({ maxRpm: Number(e.target.value) })}
            className="h-7 w-20 text-xs"
          />
        </div>
      </div>
    </>
  );
}
