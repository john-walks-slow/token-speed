/** 图表用共享颜色与文字对比度工具。 */

export const MODEL_COLORS = [
  "oklch(0.922 0.176 149.238)",   // green
  "oklch(0.688 0.162 258.338)",   // blue
  "oklch(0.769 0.188 70.08)",     // amber
  "oklch(0.627 0.265 303.9)",     // purple
  "oklch(0.715 0.143 215.221)",   // cyan
  "oklch(0.828 0.189 84.429)",    // yellow
  "oklch(0.64 0.082 229.91)",     // slate
  "oklch(0.685 0.169 27.33)",     // red
];

export function getModelColor(idx: number) {
  return MODEL_COLORS[idx % MODEL_COLORS.length];
}

/** oklch 背景上文字该用黑还是白：感知亮度（oklch 的 L 近似明度）。
 * 阈值偏高的目的：优先用白字（深色 UI 下白字观感更协调），仅亮背景才转黑字。
 * 仅支持本文件 MODEL_COLORS 的 oklch 色值；其他格式解析失败回退白字。 */
export function inkColorOn(background: string): string {
  const l = Number(/oklch\(([\d.]+)/.exec(background)?.[1]);
  return l > 0.75 ? "oklch(0.205 0 0)" : "oklch(0.985 0 0)";
}
