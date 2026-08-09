import type { TestHistory } from "@/types";

export type PresetKey = "today" | "1h" | "24h" | "7d" | "30d" | "all";

export interface CustomRange {
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD
}

/** 时间段：预设 key 或自定义起止（日期字符串）。 */
export type TimeRangeValue =
  | { type: "preset"; key: PresetKey }
  | { type: "custom"; from: string; to: string };

export const PRESET_LABELS: Record<PresetKey, string> = {
  today: "今天",
  "1h": "近1小时",
  "24h": "近24小时",
  "7d": "近7天",
  "30d": "近30天",
  all: "全部",
};

const PRESET_MS: Record<Exclude<PresetKey, "today" | "all">, number> = {
  "1h": 3600000,
  "24h": 86400000,
  "7d": 604800000,
  "30d": 2592000000,
};

/** 判断记录是否落在某时间段内。 */
export function inTimeRange(ts: number, range: TimeRangeValue): boolean {
  if (range.type === "preset") {
    if (range.key === "all") return true;
    if (range.key === "today") {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      return ts >= start.getTime();
    }
    return ts >= Date.now() - PRESET_MS[range.key];
  }
  // custom：from 起 00:00，to 止 23:59:59.999（含当天）
  const from = new Date(`${range.from}T00:00:00`).getTime();
  const to = new Date(`${range.to}T23:59:59.999`).getTime();
  if (Number.isNaN(from) || Number.isNaN(to)) return true; // 未填完整视为不过滤
  return ts >= from && ts <= to;
}

/** 过滤测试记录（保持原顺序）。 */
export function filterTestsByRange(
  tests: TestHistory[],
  range: TimeRangeValue
): TestHistory[] {
  return tests.filter((t) => inTimeRange(new Date(t.created_at).getTime(), range));
}
