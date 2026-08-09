import { useState, useEffect, useCallback } from "react";
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
  RotateCcw,
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

  // Model management dialog
  const [managingProvider, setManagingProvider] = useState<Provider | null>(null);
  const [manageInput, setManageInput] = useState("");
  const [detecting, setDetecting] = useState(false);

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

  /** 合并检测结果，保留已有模型的添加顺序，仅追加新检测到的模型。 */
  const mergeDetectedModels = useCallback((existing: string[], detected: string[]) => {
    const seen = new Set(existing);
    const merged = [...existing];
    for (const m of detected) {
      if (!seen.has(m)) {
        seen.add(m);
        merged.push(m);
      }
    }
    return merged;
  }, []);

  const handleDetectModels = useCallback(
    async (p: Provider) => {
      setDetecting(true);
      try {
        const res = await connect(p.base_url, p.api_key, p.protocol);
        const modelIds = res.success ? res.models.map((m) => m.id) : [];
        if (modelIds.length > 0) {
          const merged = mergeDetectedModels(p.models || [], modelIds);
          const updated = await updateProviderModels(p.id, merged);
          if (updated && managingProvider?.id === p.id) {
            setManagingProvider(updated);
          }
        }
        await refresh();
      } catch {
        // ignore
      } finally {
        setDetecting(false);
      }
    },
    [refresh, managingProvider, mergeDetectedModels]
  );

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

  const handleAddModel = async () => {
    if (!managingProvider || !manageInput.trim()) return;
    const newModels = [...(managingProvider.models || []), manageInput.trim()];
    const updated = await updateProviderModels(managingProvider.id, newModels);
    if (updated) setManagingProvider(updated);
    await refresh();
    setManageInput("");
  };

  const handleRemoveModel = async (modelId: string) => {
    if (!managingProvider) return;
    const newModels = (managingProvider.models || []).filter((m) => m !== modelId);
    const updated = await updateProviderModels(managingProvider.id, newModels);
    if (updated) setManagingProvider(updated);
    await refresh();
  };

  const openManage = (p: Provider) => {
    setManagingProvider(p);
    setManageInput("");
  };

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
          <Card className="border border-primary/40 bg-primary/5">
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
            <Card key={p.id} className="border border-primary/40 bg-primary/5">
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
                    <Badge
                      variant="outline"
                      className={`text-[10px] px-1 py-0 ${
                        p.protocol === "anthropic" ? "text-amber-600 border-amber-600/40" : "text-muted-foreground"
                      }`}
                    >
                      {p.protocol === "anthropic" ? "Anthropic 格式" : "OpenAI 兼容"}
                    </Badge>
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
                <div className="text-[10px] text-muted-foreground truncate mt-0.5">{p.base_url}</div>
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
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{managingProvider.name} — 模型管理</span>
                  <button onClick={() => setManagingProvider(null)} className="text-muted-foreground hover:text-foreground cursor-pointer">
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {/* Detect button */}
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => handleDetectModels(managingProvider)}
                  disabled={detecting}
                >
                  {detecting ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />
                  ) : (
                    <RotateCcw className="w-3.5 h-3.5 mr-1" />
                  )}
                  检测模型
                </Button>

                <div className="flex gap-2">
                  <Input placeholder="输入模型名称" value={manageInput} onChange={(e) => setManageInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleAddModel()} />
                  <Button size="sm" onClick={handleAddModel} disabled={!manageInput.trim()}>添加</Button>
                </div>
                <div className="max-h-48 overflow-y-auto space-y-1">
                  {(managingProvider.models || []).length === 0 ? (
                    <p className="text-xs text-muted-foreground py-2">暂无模型，点击上方"检测模型"自动检测或手动添加</p>
                  ) : (
                    (managingProvider.models || []).map((m) => (
                      <div key={m} className="flex items-center justify-between py-1 px-2 rounded hover:bg-muted/50">
                        <span className="text-xs">{m}</span>
                        <button onClick={() => handleRemoveModel(m)} className="text-muted-foreground hover:text-destructive cursor-pointer">
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))
                  )}
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
