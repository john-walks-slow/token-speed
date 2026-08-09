import { Badge } from "@/components/ui/badge";

export interface ModelGroup {
  id: string;
  name: string;
  models: string[];
}

interface Props {
  groups: ModelGroup[];
  selectedKeys: Set<string>;
  onToggle: (key: string) => void;
  onToggleAll: (groupId: string, models: string[], select: boolean) => void;
  /** 选中徽标着色的回调；返回 undefined 时用默认 primary。 */
  colorSelected?: (key: string) => string | undefined;
  title?: string;
}

export default function ModelSelector({
  groups,
  selectedKeys,
  onToggle,
  onToggleAll,
  colorSelected,
  title = "选择测速模型",
}: Props) {
  const filtered = groups
    .map((g) => ({ ...g, models: [...new Set(g.models)] }))
    .filter((g) => g.models.length > 0);
  if (filtered.length === 0) {
    return (
      <div className="text-sm text-muted-foreground py-8 text-center">
        还没有模型，在左侧服务商点击 🔄 检测模型或手动添加
      </div>
    );
  }

  const totalModels = filtered.reduce((sum, g) => sum + g.models.length, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{title}</span>
        <span className="text-xs text-muted-foreground">
          已选 {selectedKeys.size}/{totalModels}
        </span>
      </div>

      {filtered.map((g) => {
        const providerSelected = Array.from(selectedKeys.keys()).filter((k) =>
          k.startsWith(g.id + "|")
        );
        return (
          <div key={g.id} className="space-y-1.5">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => {
                  const allSelected = providerSelected.length === g.models.length;
                  onToggleAll(g.id, g.models, !allSelected);
                }}
                className="flex items-center gap-1.5 cursor-pointer group"
              >
                <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider group-hover:text-foreground transition-colors">
                  {g.name}
                </span>
                <span className="text-[10px] text-muted-foreground group-hover:text-foreground/70 transition-colors">
                  {providerSelected.length}/{g.models.length}
                </span>
              </button>
              <button
                type="button"
                onClick={() => {
                  const allSelected = providerSelected.length === g.models.length;
                  onToggleAll(g.id, g.models, !allSelected);
                }}
                className="text-[10px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer shrink-0"
              >
                {providerSelected.length === g.models.length ? "取消全选" : "全选"}
              </button>
              <div className="flex-1 h-px bg-border/50" />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {g.models.map((m) => {
                const key = `${g.id}|${m}`;
                const isSelected = selectedKeys.has(key);
                const selectedColor = isSelected && colorSelected ? colorSelected(key) : undefined;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => onToggle(key)}
                    className="cursor-pointer"
                  >
                    <Badge
                      variant={isSelected ? "default" : "outline"}
                      className={`transition-all text-xs ${
                        isSelected ? "" : "hover:border-primary/50 hover:text-foreground"
                      }`}
                      style={selectedColor ? { backgroundColor: selectedColor } : undefined}
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
