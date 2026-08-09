// lucide-react@0.475.0 上游缺少根入口的 .d.ts（package.json 指向的 dist/lucide-react.d.ts 不存在），
// 这里为本项目用到的图标提供类型。签名对齐 Lucide 的 ForwardRefExoticComponent<LucideProps & RefAttributes>。
declare module "lucide-react" {
  import type * as React from "react";

  export interface LucideProps extends React.SVGAttributes<SVGSVGElement> {
    size?: string | number;
    absoluteStrokeWidth?: boolean;
    className?: string;
  }

  type Icon = React.ForwardRefExoticComponent<
    LucideProps & React.RefAttributes<SVGSVGElement>
  >;

  export const Activity: Icon;
  export const AlertTriangle: Icon;
  export const BarChart3: Icon;
  export const Brain: Icon;
  export const CalendarClock: Icon;
  export const CheckCircle2: Icon;
  export const ChevronDown: Icon;
  export const ChevronUp: Icon;
  export const Clock: Icon;
  export const FileText: Icon;
  export const FlaskConical: Icon;
  export const Gauge: Icon;
  export const Globe: Icon;
  export const History: Icon;
  export const List: Icon;
  export const Loader2: Icon;
  export const PanelLeftClose: Icon;
  export const PanelLeftOpen: Icon;
  export const Palette: Icon;
  export const Pause: Icon;
  export const Pencil: Icon;
  export const Play: Icon;
  export const Plug: Icon;
  export const Power: Icon;
  export const PlugZap: Icon;
  export const Plus: Icon;
  export const Radio: Icon;
  export const RefreshCw: Icon;
  export const RotateCcw: Icon;
  export const Save: Icon;
  export const Settings: Icon;
  export const Trash2: Icon;
  export const TrendingUp: Icon;
  export const Trophy: Icon;
  export const X: Icon;
  export const XCircle: Icon;
  export const Zap: Icon;
}
