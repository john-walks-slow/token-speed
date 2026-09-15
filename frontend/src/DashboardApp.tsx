import { useEffect, useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import StatsPanel from "@/components/StatsPanel";
import HistoryList from "@/components/HistoryList";
import { getPublicProviders } from "@/lib/api";
import { useHashRoute } from "@/lib/router";
import type { Provider } from "@/types";
import { Activity, BarChart3, Shield, Radio } from "lucide-react";
import { Button } from "@/components/ui/button";

const DASHBOARD_TABS = ["stats", "results"];
const REFRESH_MS = 30_000;

interface Props {
  /** 配置了管理密码时的「管理登录」入口（无密码时看板不会呈现）。 */
  onLoginForAdmin?: () => void;
}

/** 只读统计视图：仅统计 + 历史，无管理/登录门。配置密码但未登录时为主端口默认视图。 */
export default function DashboardApp({ onLoginForAdmin }: Props) {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [route, navigate] = useHashRoute(DASHBOARD_TABS, "stats");
  const tab = route;
  const setTab = navigate;

  useEffect(() => {
    // 匿名只读视图用 sanitize 版 providers（api_key 已清空），仅供分组/命名
    getPublicProviders()
      .then((res) => setProviders(res.providers))
      .catch(() => {}); // 后端异常时保持空 provider 列表，不影响浏览
  }, []);

  useEffect(() => {
    const id = setInterval(() => setRefreshKey((k) => k + 1), REFRESH_MS);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="h-screen bg-background flex flex-col overflow-hidden">
      <header className="border-b border-border/50 shrink-0 z-30 bg-background/80 backdrop-blur-md">
        <div className="max-w-screen-2xl mx-auto px-4 py-3 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center">
            <Activity className="w-4 h-4 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-semibold tracking-tight">Token Speed</h1>
            <p className="text-xs text-muted-foreground hidden sm:block">
              统计视图（只读，每 30 秒自动刷新）
            </p>
          </div>
          {onLoginForAdmin && (
            <Button variant="outline" size="sm" onClick={onLoginForAdmin}>
              <Shield className="w-3.5 h-3.5 mr-1.5" />
              管理登录
            </Button>
          )}
        </div>
      </header>

      <main className="flex-1 min-h-0 overflow-y-auto">
        <div className="p-4 lg:p-6 max-w-screen-2xl mx-auto">
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="grid w-full sm:w-auto grid-cols-2 sm:inline-flex">
              <TabsTrigger value="stats">
                <BarChart3 className="w-3.5 h-3.5 mr-1.5" />
                统计
              </TabsTrigger>
              <TabsTrigger value="results">
                <Radio className="w-3.5 h-3.5 mr-1.5" />
                历史
              </TabsTrigger>
            </TabsList>

            <TabsContent value="stats">
              <StatsPanel refreshKey={refreshKey} providers={providers} />
            </TabsContent>

            <TabsContent value="results">
              <HistoryList refreshKey={refreshKey} providers={providers} readOnly />
            </TabsContent>
          </Tabs>
        </div>
      </main>

      <footer className="border-t border-border/50 shrink-0">
        <div className="max-w-screen-2xl mx-auto px-4 py-3 text-center text-xs text-muted-foreground">
          Token Speed — 只读视图
        </div>
      </footer>
    </div>
  );
}