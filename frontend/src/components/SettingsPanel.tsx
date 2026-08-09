import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { getAutostart, setAutostart, getNetworkSettings, setNetworkSettings } from "@/lib/api";
import { getTheme, setTheme, type ThemeMode } from "@/lib/theme";
import type { AutostartSettings, NetworkSettings } from "@/types";
import { Loader2 } from "lucide-react";

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
      <div className="text-sm text-destructive">
        {error}
        <button className="underline ml-2" onClick={() => setError("")}>
          关闭
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>外观</CardTitle>
          <CardDescription>界面深浅色模式，默认跟随系统</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            {THEME_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => changeTheme(opt.value)}
                className={`px-4 py-2 rounded-md text-sm border transition-colors cursor-pointer ${
                  theme === opt.value
                    ? "bg-primary text-primary-foreground border-primary"
                    : "border-border bg-card hover:bg-accent"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>网络</CardTitle>
          <CardDescription>代理与 TLS 配置，对连接检测与测速即时生效</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
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
            <button
              className="px-4 py-2 rounded-md text-sm bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              disabled={!netDirty || saving}
              onClick={saveNetwork}
            >
              {saving ? "保存中…" : "保存"}
            </button>
            {saveMsg && (
              <span className="text-sm text-muted-foreground">{saveMsg}</span>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>开机自启</CardTitle>
          <CardDescription>登录 Windows 后自动在后台运行 Token Speed（定时测速持续生效）</CardDescription>
        </CardHeader>
        <CardContent>
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
