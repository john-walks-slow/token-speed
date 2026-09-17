import { AlertTriangle, XCircle } from "lucide-react";
import HoverPopover from "@/components/HoverPopover";
import { Card, CardContent } from "@/components/ui/card";

interface Props {
  message?: string | null;
}

/** 失败行统一展示：图标 + 单行截断的错误摘要 + hover 查看完整信息。无消息时显示「失败」占位。
 * 测速结果行与历史列表共用。 */
export default function FailureInfo({ message }: Props) {
  return (
    <div className="flex items-center gap-1.5 text-destructive/80 min-w-0">
      <XCircle className="w-3.5 h-3.5 shrink-0" />
      <span className="truncate flex-1">{message || "失败"}</span>
      {message && (
        <HoverPopover
          className="w-80 max-w-md"
          trigger={
            <AlertTriangle
              className="w-3.5 h-3.5 text-destructive hover:text-destructive/80 transition-colors cursor-help shrink-0"
              aria-label="查看错误"
            />
          }
          content={
            <Card className="border-border bg-background shadow-lg">
              <CardContent className="p-3">
                <p className="text-[10px] text-destructive uppercase tracking-wider font-medium mb-1.5">
                  错误信息
                </p>
                <pre className="whitespace-pre-wrap break-words text-xs leading-relaxed max-h-64 overflow-y-auto text-destructive/90">
                  {message}
                </pre>
              </CardContent>
            </Card>
          }
        />
      )}
    </div>
  );
}
