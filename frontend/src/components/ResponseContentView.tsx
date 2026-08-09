import { Card, CardContent } from "@/components/ui/card";
import { FileText } from "lucide-react";
import HoverPopover from "@/components/HoverPopover";

interface Props {
  content?: string | null;
}

/** hover 小图标，展示测速的回复内容。无内容时渲染 null。 */
export default function ResponseContentView({ content }: Props) {
  if (!content) return null;

  return (
    <HoverPopover
      className="w-80 max-w-md"
      trigger={
        <FileText
          className="w-3.5 h-3.5 text-muted-foreground hover:text-primary transition-colors cursor-help shrink-0"
          aria-label="查看响应"
        />
      }
      content={
        <Card className="border-border bg-background shadow-lg">
          <CardContent className="p-3">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium mb-1.5">
              响应内容
            </p>
            <pre className="whitespace-pre-wrap break-words text-xs leading-relaxed max-h-64 overflow-y-auto">
              {content}
            </pre>
          </CardContent>
        </Card>
      }
    />
  );
}
