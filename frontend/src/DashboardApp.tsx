import { useEffect, useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import StatsPanel from "@/components/StatsPanel";
import HistoryList from "@/components/HistoryList";
import { getProviders } from "@/lib/api";
import { useHashRoute } from "@/lib/router";
import type { Provider } from "@/types";
import { Activity, BarChart3, Radio } from "lucide-react";

const DASHBOARD_TABS = ["stats", "results"];
const REFRESH_MS = 30_000;

/** 只读统计看板：仅统计 + 历史，无侧边栏/管理/登录门。30s 自动刷新。 */
export default function DashboardApp() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [route, navigate] = useHashRoute(DASHBOARD_TABS, "stats");
  const tab = route;
  const setTab = navigate;

  useEffect(() => {
    // 看板 providers 为 sanitize 版（api_key 已清空），仅供分组/命名
    getProviders()
      .then((res) => setProviders(res.providers))
      .catch(() => {}); // 看板后端异常时保持空 provider 列表，不影响浏览
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
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Token Speed</h1>
            <p className="text-xs text-muted-foreground hidden sm:block">
              统计看板（只读，每 30 秒自动刷新）
            </p>
          </div>
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
          Token Speed Dashboard — 只读
        </div>
      </footer>
    </div>
  );
}
