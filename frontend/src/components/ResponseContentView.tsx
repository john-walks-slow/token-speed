import { Card, CardContent } from "@/components/ui/card";
import { FileText } from "lucide-react";

interface Props {
  content?: string | null;
}

/** hover 小图标，展示测速的回复内容。无内容时渲染 null。 */
export default function ResponseContentView({ content }: Props) {
  if (!content) return null;

  return (
    <span className="relative group inline-flex">
      <FileText
        className="w-3.5 h-3.5 text-muted-foreground hover:text-primary transition-colors cursor-help"
        aria-label="查看响应"
      />
      <span className="absolute right-0 top-full z-30 mt-1 hidden group-hover:block w-80 max-w-md">
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
      </span>
    </span>
  );
}
