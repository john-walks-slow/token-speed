import { Badge } from "@/components/ui/badge";
import type { Provider, SpeedTestItem } from "@/types";

interface Props {
  providers: Provider[];
  selected: Map<string, SpeedTestItem>;
  onToggle: (providerId: string, model: string, baseUrl: string, apiKey: string) => void;
  onToggleAll: (providerId: string, models: string[], baseUrl: string, apiKey: string, select: boolean) => void;
}

export default function ModelSelector({ providers, selected, onToggle, onToggleAll }: Props) {
  const hasModels = providers.some((p) => p.models && p.models.length > 0);

  if (!hasModels) {
    return (
      <div className="text-sm text-muted-foreground py-8 text-center">
        还没有模型，在左侧服务商点击 🔄 检测模型或手动添加
      </div>
    );
  }

  const totalModels = providers.reduce((sum, p) => sum + (p.models?.length || 0), 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">选择测速模型</span>
        <span className="text-xs text-muted-foreground">
          已选 {selected.size}/{totalModels}
        </span>
      </div>

      {providers
        .filter((p) => p.models && p.models.length > 0)
        .map((p) => {
          const providerSelected = Array.from(selected.keys()).filter((k) =>
            k.startsWith(p.id + "|")
          );
          return (
            <div key={p.id} className="space-y-1.5">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    const allSelected = providerSelected.length === p.models.length;
                    onToggleAll(p.id, p.models, p.base_url, p.api_key, !allSelected);
                  }}
                  className="flex items-center gap-1.5 cursor-pointer group"
                >
                  <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider group-hover:text-foreground transition-colors">
                    {p.name}
                  </span>
                  <span className="text-[10px] text-muted-foreground group-hover:text-foreground/70 transition-colors">
                    {providerSelected.length}/{p.models.length}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const allSelected = providerSelected.length === p.models.length;
                    onToggleAll(p.id, p.models, p.base_url, p.api_key, !allSelected);
                  }}
                  className="text-[10px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer shrink-0"
                >
                  {providerSelected.length === p.models.length ? "取消全选" : "全选"}
                </button>
                <div className="flex-1 h-px bg-border/50" />
              </div>
              <div className="flex flex-wrap gap-1.5">
                {p.models.map((m) => {
                  const key = `${p.id}|${m}`;
                  const isSelected = selected.has(key);
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => onToggle(p.id, m, p.base_url, p.api_key)}
                      className="cursor-pointer"
                    >
                      <Badge
                        variant={isSelected ? "default" : "outline"}
                        className={`transition-all text-xs ${
                          isSelected ? "" : "hover:border-primary/50 hover:text-foreground"
                        }`}
                      >
                        {m}
                      </Badge>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
    </div>
  );
}
