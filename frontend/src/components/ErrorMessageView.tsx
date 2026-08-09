import { Card, CardContent } from "@/components/ui/card";
import { AlertTriangle } from "lucide-react";
import HoverPopover from "@/components/HoverPopover";

interface Props {
  message?: string | null;
}

/** hover 小图标，展示测速失败的 error_message。无消息时不渲染。 */
export default function ErrorMessageView({ message }: Props) {
  if (!message) return null;

  return (
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
  );
}
