import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { getAutostart, setAutostart, getNetworkSettings, setNetworkSettings } from "@/lib/api";
import { getTheme, setTheme, type ThemeMode } from "@/lib/theme";
import type { AutostartSettings, NetworkSettings } from "@/types";
import { Loader2, Palette, Globe, Power } from "lucide-react";

const THEME_OPTIONS: { value: ThemeMode; label: string }[] = [
  { value: "system", label: "跟随系统" },
  { value: "light", label: "浅色" },
  { value: "dark", label: "深色" },
];

const PROXY_OPTIONS: { value: NetworkSettings["proxy_mode"]; label: string }[] = [
  { value: "system", label: "系统代理" },
  { value: "custom", label: "自定义代理" },
  { value: "none", label: "关闭（直连）" },
];

const initialNetwork: NetworkSettings = {
  proxy_mode: "system",
  custom_proxy: "",
  verify_ssl: true,
};

/** 分区标题：图标 + 标题 + 说明，与 History/Stats/Schedule 的标题行风格一致。 */
function SectionTitle({
  icon,
  title,
  desc,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <div className="flex items-start gap-2">
      <span className="mt-0.5 shrink-0 text-muted-foreground">{icon}</span>
      <div>
        <div className="text-sm font-medium">{title}</div>
        <p className="text-xs text-muted-foreground">{desc}</p>
      </div>
    </div>
  );
}

export default function SettingsPanel() {
  const [settings, setSettings] = useState<AutostartSettings | null>(null);
  const [theme, setThemeMode] = useState<ThemeMode>(getTheme);
  const [net, setNet] = useState<NetworkSettings>(initialNetwork);
  const [form, setForm] = useState<NetworkSettings>(initialNetwork);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    getAutostart()
      .then(setSettings)
      .catch((e) => setError(e instanceof Error ? e.message : "加载设置失败"));
    getNetworkSettings()
      .then((data) => { setNet(data); setForm(data); })
      .catch((e) => setError(e instanceof Error ? e.message : "加载网络设置失败"));
  }, []);

  const toggleAutostart = async (enabled: boolean) => {
    try {
      setError("");
      const next = await setAutostart(enabled);
      setSettings(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    }
  };

  const changeTheme = (mode: ThemeMode) => {
    setTheme(mode);
    setThemeMode(mode);
  };

  const netDirty = JSON.stringify(form) !== JSON.stringify(net);

  const saveNetwork = async () => {
    try {
      setSaving(true);
      setSaveMsg("");
      const saved = await setNetworkSettings(form);
      setNet(saved);
      setForm(saved);
      setSaveMsg("已保存");
      setTimeout(() => setSaveMsg(""), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存网络设置失败");
    } finally {
      setSaving(false);
    }
  };

  if (error) {
    return (
      <Card className="border-0 bg-card/30">
        <CardContent className="p-4 text-sm text-destructive">
          {error}
          <button className="underline ml-2 cursor-pointer" onClick={() => setError("")}>
            关闭
          </button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      {/* 面板标题 */}
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">设置</span>
        <div className="w-8" />
      </div>

      {/* 外观 */}
      <Card className="border-0 bg-card/30">
        <CardContent className="p-4 space-y-4">
          <SectionTitle icon={<Palette className="w-4 h-4" />} title="外观" desc="界面深浅色模式，默认跟随系统" />
          <div className="flex flex-wrap gap-1.5">
            {THEME_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => changeTheme(opt.value)}
                className={`text-xs px-3 py-1.5 rounded-full border transition-colors cursor-pointer ${
                  theme === opt.value
                    ? "border-primary bg-primary/15 text-primary"
                    : "border-border text-muted-foreground hover:border-primary/50"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* 网络 */}
      <Card className="border-0 bg-card/30">
        <CardContent className="p-4 space-y-4">
          <SectionTitle
            icon={<Globe className="w-4 h-4" />}
            title="网络"
            desc="代理与 TLS 配置，对连接检测与测速即时生效"
          />
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm">代理模式</label>
              <Select
                value={form.proxy_mode}
                onChange={(e) =>
                  setForm({ ...form, proxy_mode: e.target.value as NetworkSettings["proxy_mode"] })
                }
              >
                {PROXY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </Select>
            </div>

            {form.proxy_mode === "custom" && (
              <div className="space-y-1.5">
                <label className="text-sm">代理地址</label>
                <Input
                  placeholder="http://127.0.0.1:7890"
                  value={form.custom_proxy}
                  onChange={(e) => setForm({ ...form, custom_proxy: e.target.value })}
                />
              </div>
            )}

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                className="accent-primary h-4 w-4"
                checked={!form.verify_ssl}
                onChange={(e) => setForm({ ...form, verify_ssl: !e.target.checked })}
              />
              <span className="text-sm">忽略 TLS 证书错误</span>
            </label>

            <div className="flex items-center gap-3 pt-1">
              <Button disabled={!netDirty || saving} onClick={saveNetwork}>
                {saving ? "保存中…" : "保存"}
              </Button>
              {saveMsg && (
                <span className="text-sm text-muted-foreground">{saveMsg}</span>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 开机自启 */}
      <Card className="border-0 bg-card/30">
        <CardContent className="p-4 space-y-4">
          <SectionTitle
            icon={<Power className="w-4 h-4" />}
            title="开机自启"
            desc="登录 Windows 后自动在后台运行 Token Speed（定时测速持续生效）"
          />
          {settings === null ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              加载设置…
            </div>
          ) : settings.supported ? (
            <label className="flex items-center justify-between cursor-pointer">
              <span className="text-sm">随系统启动时自动运行</span>
              <input
                type="checkbox"
                className="accent-primary h-5 w-5 cursor-pointer"
                checked={settings.enabled}
                onChange={(e) => toggleAutostart(e.target.checked)}
              />
            </label>
          ) : (
            <p className="text-sm text-muted-foreground">
              仅桌面版支持开机自启（当前为开发/服务器模式）。
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
