import type { TestHistory } from "@/types";

export type PresetKey = "1h" | "8h" | "24h" | "7d" | "all";

export interface CustomRange {
  from: string; // 时刻，如 2026-09-14T08:30
  to: string;
}

/** 时间段：预设 key 或自定义起止（精确到分钟）。 */
export type TimeRangeValue =
  | { type: "preset"; key: PresetKey }
  | { type: "custom"; from: string; to: string };

export const PRESET_LABELS: Record<PresetKey, string> = {
  "1h": "近1小时",
  "8h": "近8小时",
  "24h": "近24小时",
  "7d": "近7天",
  all: "全部",
};

const PRESET_MS: Record<Exclude<PresetKey, "all">, number> = {
  "1h": 3600000,
  "8h": 28800000,
  "24h": 86400000,
  "7d": 604800000,
};

/** 判断记录是否落在某时间段内。 */
export function inTimeRange(ts: number, range: TimeRangeValue): boolean {
  if (range.type === "preset") {
    if (range.key === "all") return true;
    return ts >= Date.now() - PRESET_MS[range.key];
  }
  // custom：起止精确到分钟（datetime-local 格式'YYYY-MM-DDTHH:mm'，可省略时间部分按 00:00/23:59）
  const from = parseCustom(range.from, false);
  const to = parseCustom(range.to, true);
  if (Number.isNaN(from) || Number.isNaN(to)) {
    // 未填完整视为不过滤
    if (Number.isNaN(from) && Number.isNaN(to)) return true;
    return Number.isNaN(from) ? ts <= to : ts >= from;
  }
  return ts >= from && ts <= to;
}

/** 解析自定义时间：无时间部分时 from 按 00:00、to 按 23:59:59.999。 */
function parseCustom(v: string, isEnd: boolean): number {
  const hasTime = v.length > 10 && v.includes("T");
  if (hasTime) return new Date(v).getTime();
  const d = new Date(`${v}T${isEnd ? "23:59:59.999" : "00:00:00"}`);
  return d.getTime();
}

/** 过滤测试记录（保持原顺序）。 */
export function filterTestsByRange(
  tests: TestHistory[],
  range: TimeRangeValue
): TestHistory[] {
  return tests.filter((t) => inTimeRange(new Date(t.created_at).getTime(), range));
}