import { useState, useEffect, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  connect,
  getProviders,
  createProvider,
  updateProvider,
  deleteProvider,
  updateProviderModels,
} from "@/lib/api";
import type { Provider } from "@/types";
import {
  Plug,
  PlugZap,
  Loader2,
  Plus,
  X,
  Pencil,
  Trash2,
  Search,
  List,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

interface Props {
  onProvidersChange: (providers: Provider[]) => void;
}

export default function ConnectionConfig({ onProvidersChange }: Props) {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formName, setFormName] = useState("");
  const [formUrl, setFormUrl] = useState("");
  const [formKey, setFormKey] = useState("");
  const [formProtocol, setFormProtocol] = useState<"openai" | "anthropic">("openai");
  const [saving, setSaving] = useState(false);

  // Model management dialog — 统一勾选清单模型
  const [managingProvider, setManagingProvider] = useState<Provider | null>(null);
  // 清单真相源：打开时以已添加模型初始化，勾选/取消即编辑，保存时一次性提交
  const [selectedModels, setSelectedModels] = useState<Set<string>>(new Set());
  // 检测到的候选模型（含已有），未在清单中的项保存时视为移除
  const [allCandidates, setAllCandidates] = useState<string[]>([]);
  const [searchInput, setSearchInput] = useState("");
  const [manualInput, setManualInput] = useState("");
  const [detecting, setDetecting] = useState(false);
  const [detectError, setDetectError] = useState("");
  const [savingModels, setSavingModels] = useState(false);

  // Delete confirmation dialog
  const [pendingDelete, setPendingDelete] = useState<Provider | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Mobile collapsible
  const [mobileOpen, setMobileOpen] = useState(false);

  const refresh = useCallback(async () => {
    const res = await getProviders();
    setProviders(res.providers);
    onProvidersChange(res.providers);
  }, [onProvidersChange]);

  useEffect(() => {
    refresh();
  }, []);

  const handleDetectModels = useCallback(async (p: Provider) => {
    setDetecting(true);
    setDetectError("");
    try {
      const res = await connect(p.base_url, p.api_key, p.protocol);
      if (res.success) {
        // 检测结果并入候选集（保留已有顺序，追加新项）；勾选状态不变
        const known = new Set(allCandidates);
        const merged = [...allCandidates];
        for (const m of res.models.map((x) => x.id)) {
          if (!known.has(m)) {
            known.add(m);
            merged.push(m);
          }
        }
        setAllCandidates(merged);
      } else {
        setDetectError(res.error || "检测失败");
      }
    } catch {
      setDetectError("检测失败，请检查网络或 Base URL");
    } finally {
      setDetecting(false);
    }
  }, [allCandidates]);

  /** 保存：把清单当前状态一次性写入（增删都在其中）。 */
  const handleSaveModels = async () => {
    if (!managingProvider) return;
    setSavingModels(true);
    try {
      // 保留原有顺序中的保留项，新勾选项按清单顺序追加
      const original = managingProvider.models || [];
      const kept = original.filter((m) => selectedModels.has(m));
      const added = allCandidates.filter((m) => selectedModels.has(m) && !original.includes(m));
      const updated = await updateProviderModels(managingProvider.id, [...kept, ...added]);
      setManagingProvider(updated);
      await refresh();
    } finally {
      setSavingModels(false);
    }
  };

  const handleSaveProvider = async () => {
    if (!formName.trim() || !formUrl.trim()) return;
    setSaving(true);
    const isEdit = !!editingId;
    const name = formName.trim();
    const url = formUrl.trim();
    const key = formKey.trim();
    const protocol = formProtocol;

    // Create or update
    if (isEdit) {
      await updateProvider(editingId, { name, base_url: url, api_key: key, protocol });
    } else {
      const created = await createProvider({ name, base_url: url, api_key: key, protocol });
      await refresh();
      // Auto-detect models after creation
      const res = await connect(created.base_url, created.api_key, protocol);
      if (res.success && res.models.length > 0) {
        await updateProviderModels(created.id, res.models.map((m) => m.id));
      }
    }

    // Close form immediately before refresh
    setShowForm(false);
    setEditingId(null);
    setFormName("");
    setFormUrl("");
    setFormKey("");
    setFormProtocol("openai");
    setSaving(false);
    await refresh();
  };

  const handleEditProvider = (p: Provider) => {
    setEditingId(p.id);
    setFormName(p.name);
    setFormUrl(p.base_url);
    setFormKey(p.api_key);
    setFormProtocol(p.protocol || "openai");
    setShowForm(true);
  };

  const handleDeleteProvider = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await deleteProvider(pendingDelete.id);
      setPendingDelete(null);
      await refresh();
    } finally {
      setDeleting(false);
    }
  };

  /** 手动添加：作为候选项插入清单顶部并自动勾选。 */
  const handleAddManualModel = () => {
    const id = manualInput.trim();
    if (!id) return;
    setAllCandidates((prev) => (prev.includes(id) ? prev : [id, ...prev]));
    setSelectedModels((prev) => new Set(prev).add(id));
    setManualInput("");
  };

  const openManage = (p: Provider) => {
    setManagingProvider(p);
    setSelectedModels(new Set(p.models || []));
    setAllCandidates(p.models || []);
    setSearchInput("");
    setManualInput("");
    setDetectError("");
  };

  /** 清单与已保存列表是否不一致（有未保存的增删）。 */
  const dirtyModels =
    !!managingProvider &&
    ((managingProvider.models || []).some((m) => !selectedModels.has(m)) ||
      [...selectedModels].some((m) => !(managingProvider.models || []).includes(m)));

  const header = (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <Plug className="w-4 h-4 text-muted-foreground" />
        <span className="text-sm font-medium">服务商</span>
        {providers.length > 0 && (
          <span className="text-xs text-muted-foreground">{providers.length}</span>
        )}
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          setShowForm(true);
          setEditingId(null);
          setFormName("");
          setFormUrl("");
          setFormKey("");
          setFormProtocol("openai");
        }}
      >
        <Plus className="w-3.5 h-3.5" />
        添加
      </Button>
    </div>
  );

  const providerForm = (
    <div className="space-y-2">
      <Input placeholder="名称" value={formName} onChange={(e) => setFormName(e.target.value)} />
      <Input placeholder="Base URL，如 https://openrouter.ai/api/v1" value={formUrl} onChange={(e) => setFormUrl(e.target.value)} />
      <Select
        value={formProtocol}
        onChange={(e) => setFormProtocol(e.target.value as "openai" | "anthropic")}
      >
        <option value="openai">OpenAI 兼容</option>
        <option value="anthropic">Anthropic 格式</option>
      </Select>
      <Input type="password" placeholder="API Key (可选)" value={formKey} onChange={(e) => setFormKey(e.target.value)} />
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={() => { setShowForm(false); setEditingId(null); }}>取消</Button>
        <Button size="sm" onClick={handleSaveProvider} disabled={saving || !formName.trim() || !formUrl.trim()}>
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
          {editingId ? "保存" : "添加"}
        </Button>
      </div>
    </div>
  );

  const content = (
    <div className="space-y-3">
      {/* Provider list */}
      {providers.length === 0 && !showForm && (
        <p className="text-xs text-muted-foreground py-2">还没有服务商，点击"添加"开始</p>
      )}
      <div className="space-y-1.5">
        {/* Add form at top when adding */}
        {showForm && !editingId && (
          <Card className="border-primary/40 bg-card">
            <CardContent className="p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium">添加服务商</span>
                <button onClick={() => setShowForm(false)} className="text-muted-foreground hover:text-foreground cursor-pointer">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              {providerForm}
            </CardContent>
          </Card>
        )}
        {providers.map((p) => {
          const isEditing = editingId === p.id && showForm;
          const hasCached = p.models && p.models.length > 0;
          return isEditing ? (
            <Card key={p.id} className="border-primary/40 bg-card">
              <CardContent className="p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium">编辑服务商</span>
                  <button onClick={() => { setShowForm(false); setEditingId(null); }} className="text-muted-foreground hover:text-foreground cursor-pointer">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                {providerForm}
              </CardContent>
            </Card>
          ) : (
            <Card key={p.id} className="border border-border">
              <CardContent className="px-3 py-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <PlugZap className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    <span className="text-sm font-medium truncate">{p.name}</span>
                    {hasCached && (
                      <Badge variant="outline" className="text-[10px] px-1 py-0">
                        {p.models.length}
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-0.5 shrink-0">
                    <button
                      title="管理模型"
                      onClick={() => openManage(p)}
                      className="text-muted-foreground hover:text-foreground p-0.5 cursor-pointer"
                    >
                      <List className="w-3.5 h-3.5" />
                    </button>
                    <button
                      title="编辑"
                      onClick={() => handleEditProvider(p)}
                      className="text-muted-foreground hover:text-foreground p-0.5 cursor-pointer"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      title="删除"
                      onClick={() => setPendingDelete(p)}
                      className="text-muted-foreground hover:text-destructive p-0.5 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                <div className="flex items-center text-[10px] text-muted-foreground mt-0.5">
                  <span className="truncate">{p.base_url}</span>
                  <span className="shrink-0"> · {p.protocol === "anthropic" ? "Anthropic 格式" : "OpenAI 兼容"}</span>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop: always visible */}
      <div className="hidden lg:block">
        <Card className="border-0 shadow-none bg-transparent">
          <CardContent className="p-0 space-y-3">
            {header}
            {content}
          </CardContent>
        </Card>
      </div>

      {/* Mobile: collapsible — the toggle button IS the header */}
      <div className="lg:hidden">
        <Card className="border-0 shadow-none bg-transparent">
          <CardContent className="p-0">
            <button
              onClick={() => setMobileOpen(!mobileOpen)}
              className="flex items-center justify-between w-full cursor-pointer"
            >
              <div className="flex items-center gap-2">
                <Plug className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm font-medium">服务商</span>
                <span className="text-xs text-muted-foreground">{providers.length}</span>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    setMobileOpen(true);
                    setShowForm(true);
                    setEditingId(null);
                    setFormName("");
                    setFormUrl("");
                    setFormKey("");
                    setFormProtocol("openai");
                  }}
                >
                  <Plus className="w-3.5 h-3.5" />
                  添加
                </Button>
                {mobileOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
              </div>
            </button>
            {mobileOpen && <div className="mt-3">{content}</div>}
          </CardContent>
        </Card>
      </div>

      {/* Model management dialog — portal 到 body，避免被侧边栏的 sticky/overflow 层叠上下文盖住 */}
      {managingProvider &&
        createPortal(
          <div className="fixed inset-0 z-[100] bg-black/50 flex items-center justify-center p-4" onClick={() => setManagingProvider(null)}>
            <Card className="w-full max-w-md border-border bg-background" onClick={(e) => e.stopPropagation()}>
              <CardContent className="p-4 space-y-3">
                {/* 标题行 */}
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium truncate">{managingProvider.name} — 模型管理</span>
                  <button onClick={() => setManagingProvider(null)} className="text-muted-foreground hover:text-foreground cursor-pointer shrink-0">
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {/* 第一行：纯搜索框 */}
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <Input
                    className="pl-8 h-8 text-xs"
                    placeholder="搜索模型…"
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                  />
                </div>

                {/* 第二行：检测 + 添加输入 */}
                <div className="flex gap-2">
                  <Input
                    className="h-8 text-xs flex-1"
                    placeholder="手动添加模型 ID，如 gpt-5.2"
                    value={manualInput}
                    onChange={(e) => setManualInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleAddManualModel()}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 shrink-0"
                    onClick={handleAddManualModel}
                    disabled={!manualInput.trim()}
                  >
                    添加
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 shrink-0"
                    onClick={() => handleDetectModels(managingProvider)}
                    disabled={detecting}
                  >
                    {detecting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                    检测
                  </Button>
                </div>

                {detectError && <p className="text-xs text-destructive">{detectError}</p>}

                {/* 统一勾选清单 */}
                <ModelChecklist
                  candidates={allCandidates}
                  selected={selectedModels}
                  search={searchInput}
                  onToggle={(m) => {
                    setSelectedModels((prev) => {
                      const next = new Set(prev);
                      if (next.has(m)) next.delete(m);
                      else next.add(m);
                      return next;
                    });
                  }}
                  onSetAll={(ids, select) => {
                    setSelectedModels((prev) => {
                      const next = new Set(prev);
                      for (const id of ids) {
                        if (select) next.add(id);
                        else next.delete(id);
                      }
                      return next;
                    });
                  }}
                  onRemove={(m) => {
                    setSelectedModels((prev) => {
                      const next = new Set(prev);
                      next.delete(m);
                      return next;
                    });
                    setAllCandidates((prev) => prev.filter((c) => c !== m));
                  }}
                />

                {/* 底部操作栏 */}
                <div className="flex items-center gap-2 pt-1 border-t border-border">
                  <span className="text-xs text-muted-foreground flex-1">
                    已选 {selectedModels.size} / {allCandidates.length}
                    {dirtyModels && " · 未保存"}
                  </span>
                  <Button variant="ghost" size="sm" onClick={() => setManagingProvider(null)}>
                    取消
                  </Button>
                  <Button size="sm" onClick={handleSaveModels} disabled={!dirtyModels || savingModels}>
                    {savingModels ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                    保存
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>,
          document.body
        )}

      {/* Delete confirmation dialog */}
      {pendingDelete &&
        createPortal(
          <div className="fixed inset-0 z-[100] bg-black/50 flex items-center justify-center p-4" onClick={() => setPendingDelete(null)}>
            <Card className="w-full max-w-sm border-border bg-background" onClick={(e) => e.stopPropagation()}>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Trash2 className="w-4 h-4 text-destructive" />
                  <span className="text-sm font-medium">删除服务商</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  确定要删除「{pendingDelete.name}」吗？其下模型与测速历史将不再关联，该操作不可撤销。
                </p>
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setPendingDelete(null)}>
                    取消
                  </Button>
                  <Button variant="destructive" size="sm" onClick={handleDeleteProvider} disabled={deleting}>
                    {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                    删除
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>,
          document.body
        )}
    </>
  );
}

/** 统一勾选清单：已添加 + 检测到的候选模型，按搜索过滤，支持全选/清空。 */
function ModelChecklist({
  candidates,
  selected,
  search,
  onToggle,
  onSetAll,
  onRemove,
}: {
  candidates: string[];
  selected: Set<string>;
  search: string;
  onToggle: (model: string) => void;
  onSetAll: (ids: string[], select: boolean) => void;
  onRemove: (model: string) => void;
}) {
  const filtered = useMemo(
    () => candidates.filter((m) => m.toLowerCase().includes(search.trim().toLowerCase())),
    [candidates, search]
  );
  const selectedCount = filtered.filter((m) => selected.has(m)).length;
  const allFilteredSelected = filtered.length > 0 && selectedCount === filtered.length;

  if (candidates.length === 0) {
    return (
      <p className="text-xs text-muted-foreground py-4 text-center">
        暂无模型，点击「检测」自动发现或手动添加
      </p>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="flex-1">
          {search.trim() ? `匹配 ${filtered.length} / ${candidates.length}` : `${candidates.length} 个模型`}
        </span>
        {filtered.length > 0 && (
          <button
            type="button"
            className="hover:text-foreground cursor-pointer transition-colors"
            onClick={() => onSetAll(filtered, !allFilteredSelected)}
          >
            {allFilteredSelected ? "取消全选" : "全选"}
          </button>
        )}
      </div>
      <div className="max-h-64 overflow-y-auto space-y-0.5 -mx-1 px-1">
        {filtered.length === 0 ? (
          <p className="text-xs text-muted-foreground py-3 text-center">无匹配「{search.trim()}」的模型</p>
        ) : (
          filtered.map((m) => {
            const checked = selected.has(m);
            return (
              <div
                key={m}
                className={`group flex items-center gap-2 py-1.5 px-2 rounded transition-colors ${
                  checked ? "bg-primary/10" : "hover:bg-muted/50"
                }`}
              >
                <input
                  type="checkbox"
                  className="accent-primary h-3.5 w-3.5 shrink-0 cursor-pointer"
                  checked={checked}
                  onChange={() => onToggle(m)}
                  id={`model-check-${m}`}
                />
                <label htmlFor={`model-check-${m}`} className="text-xs truncate flex-1 cursor-pointer">
                  {m}
                </label>
                <button
                  type="button"
                  title="从列表移除"
                  onClick={() => onRemove(m)}
                  className="shrink-0 text-muted-foreground hover:text-destructive cursor-pointer transition-colors"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
