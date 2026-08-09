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

/** 预设 key 的展示顺序（today 只适合结果页，统计页用它当「今天」）。 */
const DEFAULT_PRESETS: PresetKey[] = ["1h", "24h", "7d", "30d", "all"];

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
    // 初始化 draft 为最近 7 天，并立即选中自定义
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - 7);
    const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const fromStr = fmt(from);
    const toStr = fmt(to);
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
              if (customOpen && value.type === "custom") {
                // 已开：保持
              } else {
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
            type="date"
            value={draft.from}
            onChange={(e) => applyCustom(e.target.value, draft.to)}
            className="h-7 w-[140px] text-xs"
          />
          <span className="text-xs text-muted-foreground">→</span>
          <Input
            type="date"
            value={draft.to}
            onChange={(e) => applyCustom(draft.from, e.target.value)}
            className="h-7 w-[140px] text-xs"
          />
        </div>
      )}
    </div>
  );
}
