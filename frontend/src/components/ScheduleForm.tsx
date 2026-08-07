import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, Save, X, AlertTriangle } from "lucide-react";
import ModelSelector from "@/components/ModelSelector";
import TestParamsFields, { DEFAULT_PARAMS, type TestParamsValues } from "@/components/TestParamsFields";
import { createSchedule, updateSchedule } from "@/lib/api";
import type { Provider, Schedule, ScheduleTarget, SpeedTestItem } from "@/types";

const INTERVAL_QUICK = [5, 15, 30, 60, 120];

interface Props {
  providers: Provider[];
  editing: Schedule | null;
  onSaved: () => void;
  onCancel: () => void;
}

/** 从 schedule.targets 重建 ModelSelector 需要的 Map；provider/模型已删除的 target 返回 null 提示。 */
function buildMapFromTargets(
  targets: ScheduleTarget[],
  providers: Provider[]
): { map: Map<string, SpeedTestItem>; stale: ScheduleTarget[] } {
  const map = new Map<string, SpeedTestItem>();
  const stale: ScheduleTarget[] = [];
  const providerById = new Map(providers.map((p) => [p.id, p]));
  for (const t of targets) {
    const p = providerById.get(t.provider_id);
    if (!p) {
      stale.push(t);
      continue;
    }
    for (const m of t.models) {
      if (!p.models.includes(m)) {
        stale.push({ provider_id: t.provider_id, models: [m] });
        continue;
      }
      map.set(`${p.id}|${m}`, {
        model: m,
        base_url: p.base_url,
        api_key: p.api_key,
        provider_id: p.id,
        provider_name: p.name,
      });
    }
  }
  return { map, stale };
}

function targetsFromMap(selected: Map<string, SpeedTestItem>): ScheduleTarget[] {
  const byProvider = new Map<string, string[]>();
  for (const [key, item] of selected.entries()) {
    const providerId = key.split("|")[0];
    if (!byProvider.has(providerId)) byProvider.set(providerId, []);
    byProvider.get(providerId)!.push(item.model);
  }
  return Array.from(byProvider.entries()).map(([provider_id, models]) => ({ provider_id, models }));
}

export default function ScheduleForm({ providers, editing, onSaved, onCancel }: Props) {
  const [name, setName] = useState("");
  const [intervalMinutes, setIntervalMinutes] = useState(30);
  const [selected, setSelected] = useState<Map<string, SpeedTestItem>>(new Map());
  const [params, setParams] = useState<TestParamsValues>(DEFAULT_PARAMS);
  const [staleWarning, setStaleWarning] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (editing) {
      setName(editing.name || "");
      setIntervalMinutes(editing.interval_minutes);
      setParams({
        prompt: editing.prompt,
        maxTokens: editing.max_tokens,
        temperature: editing.temperature,
        concurrency: editing.concurrency,
        iterations: editing.iterations,
        stream: editing.stream,
        disableReasoning: editing.disable_reasoning,
        maxRpm: editing.max_rpm,
      });
      const { map, stale } = buildMapFromTargets(editing.targets, providers);
      setSelected(map);
      setStaleWarning(
        stale.length > 0
          ? `${stale.length} 个已删除的服务商/模型将被忽略，保存后自动移除`
          : null
      );
    } else {
      setName("");
      setIntervalMinutes(30);
      setSelected(new Map());
      setParams(DEFAULT_PARAMS);
      setStaleWarning(null);
    }
  }, [editing, providers]);

  const toggleItem = useCallback(
    (key: string) => {
      const [providerId, ...rest] = key.split("|");
      const model = rest.join("|");
      setSelected((prev) => {
        const next = new Map(prev);
        if (next.has(key)) {
          next.delete(key);
        } else {
          const p = providers.find((x) => x.id === providerId);
          if (!p) return prev;
          next.set(key, {
            model,
            base_url: p.base_url,
            api_key: p.api_key,
            provider_id: p.id,
            provider_name: p.name,
          });
        }
        return next;
      });
    },
    [providers]
  );

  const toggleAllForProvider = useCallback(
    (providerId: string, models: string[], select: boolean) => {
      const p = providers.find((x) => x.id === providerId);
      if (!p) return;
      setSelected((prev) => {
        const next = new Map(prev);
        for (const m of models) {
          const key = `${providerId}|${m}`;
          if (select) {
            next.set(key, {
              model: m,
              base_url: p.base_url,
              api_key: p.api_key,
              provider_id: p.id,
              provider_name: p.name,
            });
          } else {
            next.delete(key);
          }
        }
        return next;
      });
    },
    [providers]
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    if (selected.size === 0) {
      setError("请至少选择一个模型");
      return;
    }
    if (!intervalMinutes || intervalMinutes < 1) {
      setError("间隔必须大于 0 分钟");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload = {
        name,
        interval_minutes: intervalMinutes,
        targets: targetsFromMap(selected),
        prompt: params.prompt,
        max_tokens: params.maxTokens,
        temperature: params.temperature,
        stream: params.stream,
        concurrency: params.concurrency,
        iterations: params.iterations,
        disable_reasoning: params.disableReasoning,
        max_rpm: params.maxRpm,
      };
      if (editing) await updateSchedule(editing.id, payload);
      else await createSchedule(payload);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="border-0 bg-card/30">
      <CardContent className="p-4 space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">{editing ? "编辑定时任务" : "新建定时任务"}</span>
          <button
            type="button"
            onClick={onCancel}
            className="text-muted-foreground hover:text-foreground transition-colors cursor-pointer p-1"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">任务名称</label>
              <Input placeholder="可选，如：早高峰测试" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">执行间隔（分钟）</label>
              <Input type="number" min={1} value={intervalMinutes} onChange={(e) => setIntervalMinutes(Number(e.target.value))} />
            </div>
          </div>

          <div className="flex flex-wrap gap-1">
            {INTERVAL_QUICK.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setIntervalMinutes(m)}
                className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors cursor-pointer ${
                  intervalMinutes === m
                    ? "border-primary bg-primary/15 text-primary"
                    : "border-border text-muted-foreground hover:border-primary/50"
                }`}
              >
                {m} 分
              </button>
            ))}
          </div>

          <ModelSelector
            groups={providers}
            selectedKeys={new Set(selected.keys())}
            onToggle={toggleItem}
            onToggleAll={toggleAllForProvider}
            title="选择定时测速模型"
          />

          {staleWarning && (
            <p className="flex items-center gap-1.5 text-xs text-amber-400">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              {staleWarning}
            </p>
          )}

          <TestParamsFields values={params} onChange={setParams} persist={false} />

          {error && <p className="text-xs text-destructive">{error}</p>}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
              取消
            </Button>
            <Button type="submit" size="sm" disabled={saving}>
              {saving ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  保存中...
                </>
              ) : (
                <>
                  <Save className="w-3.5 h-3.5" />
                  保存
                </>
              )}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
