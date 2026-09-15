import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { CalendarClock } from "lucide-react";
import { PRESET_LABELS, type PresetKey, type TimeRangeValue } from "@/lib/timeRange";

interface Props {
  value: TimeRangeValue;
  onChange: (range: TimeRangeValue) => void;
  /** 显示的预设项；默认显示全部。 */
  presets?: PresetKey[];
  /** 是否允许自定义时间段；默认 true。 */
  allowCustom?: boolean;
}

const DEFAULT_PRESETS: PresetKey[] = ["1h", "8h", "24h", "7d", "all"];

/** 格式化 Date 为 datetime-local 输入值 `YYYY-MM-DDTHH:mm`。 */
function fmtDateTime(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function TimeRangeFilter({
  value,
  onChange,
  presets = DEFAULT_PRESETS,
  allowCustom = true,
}: Props) {
  const [customOpen, setCustomOpen] = useState(value.type === "custom");
  const [draft, setDraft] = useState<{ from: string; to: string }>(
    value.type === "custom" ? { from: value.from, to: value.to } : { from: "", to: "" }
  );

  const applyCustom = (from: string, to: string) => {
    if (!from || !to) return;
    setDraft({ from, to });
    onChange({ type: "custom", from, to });
  };

  const openCustom = () => {
    setCustomOpen(true);
    // 初始化 draft 为最近 8 小时，并立即选中自定义
    const to = new Date();
    const from = new Date();
    from.setHours(from.getHours() - 8);
    const fromStr = fmtDateTime(from);
    const toStr = fmtDateTime(to);
    setDraft({ from: fromStr, to: toStr });
    onChange({ type: "custom", from: fromStr, to: toStr });
  };

  return (
    <div className="space-y-1.5">
      <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">时间</span>
      <div className="flex flex-wrap gap-1 items-center">
        {presets.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => {
              setCustomOpen(false);
              onChange({ type: "preset", key });
            }}
            className="inline-flex items-center cursor-pointer"
          >
            <Badge
              variant={value.type === "preset" && value.key === key ? "default" : "outline"}
              className="text-[10px] px-1.5 h-4 leading-none"
            >
              {PRESET_LABELS[key]}
            </Badge>
          </button>
        ))}
        {allowCustom && (
          <button
            type="button"
            onClick={() => {
              if (!(customOpen && value.type === "custom")) {
                openCustom();
              }
            }}
            className="inline-flex items-center cursor-pointer"
          >
            <Badge
              variant={value.type === "custom" ? "default" : "outline"}
              className="text-[10px] px-1.5 h-4 leading-none"
            >
              <CalendarClock className="w-3 h-3 mr-0.5" />
              自定义
            </Badge>
          </button>
        )}
      </div>

      {allowCustom && customOpen && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <Input
            type="datetime-local"
            value={draft.from}
            onChange={(e) => applyCustom(e.target.value, draft.to)}
            className="h-7 w-auto text-xs"
          />
          <span className="text-xs text-muted-foreground">→</span>
          <Input
            type="datetime-local"
            value={draft.to}
            onChange={(e) => applyCustom(draft.from, e.target.value)}
            className="h-7 w-auto text-xs"
          />
        </div>
      )}
    </div>
  );
}