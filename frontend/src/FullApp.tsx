import { useState, useEffect, useCallback, useRef } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import ConnectionConfig from "@/components/ConnectionConfig";
import ModelSelector from "@/components/ModelSelector";
import SpeedTestForm from "@/components/SpeedTestForm";
import SpeedTestProgress from "@/components/SpeedTestProgress";
import RunResults from "@/components/RunResults";
import HistoryList from "@/components/HistoryList";
import StatsPanel from "@/components/StatsPanel";
import SchedulePanel from "@/components/SchedulePanel";
import SettingsPanel from "@/components/SettingsPanel";
import { streamBatchSpeedTest, getProviders } from "@/lib/api";
import { useHashRoute } from "@/lib/router";
import type { Provider, SpeedTestResult, SpeedTestItem } from "@/types";
import {
  Gauge,
  BarChart3,
  Activity,
  Radio,
  PanelLeftOpen,
  PanelLeftClose,
  FlaskConical,
  CalendarClock,
  Settings,
} from "lucide-react";

const FULL_TABS = ["test", "results", "stats", "schedule", "settings"];

export default function FullApp() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [selectedTests, setSelectedTests] = useState<Map<string, SpeedTestItem>>(new Map());
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<SpeedTestResult[]>([]);
  const [progress, setProgress] = useState<{ completed: number; total: number; results: SpeedTestResult[] } | null>(null);
  const [cancelled, setCancelled] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [route, navigate] = useHashRoute(FULL_TABS, "test");
  const tab = route;
  const setTab = navigate;
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Load providers on mount
  useEffect(() => {
    getProviders().then((res) => setProviders(res.providers));
  }, []);

  // ConnectionConfig calls this when providers change (add/edit/delete/detect)
  const handleProvidersChange = useCallback((updated: Provider[]) => {
    setProviders(updated);
    // Prune selections for deleted providers/models
    setSelectedTests((prev) => {
      const next = new Map(prev);
      const validKeys = new Set<string>();
      for (const p of updated) {
        for (const m of p.models || []) {
          validKeys.add(`${p.id}|${m}`);
        }
      }
      for (const key of next.keys()) {
        if (!validKeys.has(key)) next.delete(key);
      }
      return next;
    });
  }, []);

  const providerById = useCallback(
    (id: string) => providers.find((p) => p.id === id),
    [providers]
  );

  const toggleTestItem = useCallback(
    (key: string) => {
      const [providerId, ...rest] = key.split("|");
      const model = rest.join("|");
      setSelectedTests((prev) => {
        const next = new Map(prev);
        if (next.has(key)) {
          next.delete(key);
        } else {
          const p = providerById(providerId);
          if (!p) return prev;
          next.set(key, {
            model,
            base_url: p.base_url,
            api_key: p.api_key,
            provider_id: p.id,
            provider_name: p.name,
            protocol: p.protocol,
          });
        }
        return next;
      });
    },
    [providerById]
  );

  const toggleAllForProvider = useCallback(
    (providerId: string, models: string[], select: boolean) => {
      const p = providerById(providerId);
      if (!p) return;
      setSelectedTests((prev) => {
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
              protocol: p.protocol,
            });
          } else {
            next.delete(key);
          }
        }
        return next;
      });
    },
    [providerById]
  );

  const handleRunTest = useCallback(
    async (params: {
      prompt: string;
      maxTokens: number;
      temperature: number;
      concurrency: number;
      iterations: number;
      stream: boolean;
      maxRpm: number;
    }) => {
      const tests = Array.from(selectedTests.values());
      if (tests.length === 0) return;
      const total = tests.length * params.iterations;
      setRunning(true);
      setCancelled(false);
      setResults([]);
      setProgress({ completed: 0, total, results: [] });
      const controller = new AbortController();
      abortRef.current = controller;
      const collected: SpeedTestResult[] = [];
      try {
        await streamBatchSpeedTest(
          {
            tests,
            prompt: params.prompt,
            max_tokens: params.maxTokens,
            temperature: params.temperature,
            concurrency: params.concurrency,
            iterations: params.iterations,
            stream: params.stream,
            max_rpm: params.maxRpm,
          },
          {
            onProgress: (ev) => {
              collected.push(ev.result);
              setProgress({ completed: ev.index, total: ev.total, results: collected });
            },
          },
          controller.signal
        );
        // 正常完成：收起进度面板，展示本次全部结果（含失败），不跳转
        setResults(collected);
        setProgress(null);
        setRefreshKey((k) => k + 1);
      } catch (e) {
        if (controller.signal.aborted) {
          // User cancelled — keep partial results shown in the progress panel
          setCancelled(true);
          return;
        }
        setResults([
          {
            id: "error",
            base_url: "",
            model: "error",
            actual_model: "error",
            provider_id: null,
            provider_name: null,
            response_content: null,
            prompt: "",
            max_tokens: 0,
            temperature: 0,
            ttft_ms: null,
            content_ttft_ms: null,
            total_latency_ms: 0,
            tokens_generated: 0,
            reasoning_tokens: 0,
            content_tokens: 0,
            thinking_ms: null,
            tps: null,
            success: false,
            error_message: e instanceof Error ? e.message : "测试失败",
            created_at: new Date().toISOString(),
          },
        ]);
        setProgress(null);
      } finally {
        setRunning(false);
      }
    },
    [selectedTests]
  );

  const handleCancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  /** 收起进度面板，展示本次已完成的结果（取消时面板里的结果并入 results）。 */
  const handleShowResults = useCallback(() => {
    setResults((prev) => {
      const seen = new Set(prev.map((r) => r.id));
      const merged = [...prev, ...(progress?.results ?? []).filter((r) => !seen.has(r.id))];
      return merged;
    });
    setProgress(null);
  }, [progress]);

  return (
    <div className="h-screen bg-background flex flex-col overflow-hidden">
      {/* Header */}
      <header className="border-b border-border/50 shrink-0 z-30 bg-background/80 backdrop-blur-md">
        <div className="max-w-screen-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="hidden lg:inline-flex text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            >
              {sidebarOpen ? <PanelLeftClose className="w-4 h-4" /> : <PanelLeftOpen className="w-4 h-4" />}
            </button>
            <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center">
              <Activity className="w-4 h-4 text-primary" />
            </div>
            <div>
              <h1 className="text-lg font-semibold tracking-tight">Token Speed</h1>
              <p className="text-xs text-muted-foreground hidden sm:block">
                LLM API 延迟与速度检测工具
              </p>
            </div>
          </div>
        </div>
      </header>

      <div className="flex-1 min-h-0 max-w-screen-2xl w-full mx-auto flex">
        {/* Sidebar — provider management */}
        <aside
          className={`hidden lg:flex flex-col border-r border-border/50 h-full transition-all duration-200 overflow-hidden shrink-0 ${
            sidebarOpen ? "w-80" : "w-0 border-r-0"
          }`}
        >
          <div className={`flex-1 min-h-0 overflow-y-auto p-4 ${sidebarOpen ? "block" : "hidden"}`}>
            <ConnectionConfig onProvidersChange={handleProvidersChange} />
          </div>
        </aside>

        {/* Main content — 内容区滚动，body 不滚动 */}
        <main className="flex-1 min-w-0 min-h-0 overflow-y-auto">
          {/* Mobile: provider panel at top */}
          <div className="lg:hidden p-4 border-b border-border/30">
            <ConnectionConfig onProvidersChange={handleProvidersChange} />
          </div>

          <div className="p-4 lg:p-6">
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList className="w-full sm:w-auto grid grid-cols-5 sm:inline-flex">
                <TabsTrigger value="test">
                  <Gauge className="w-3.5 h-3.5 mr-1.5" />
                  测速
                </TabsTrigger>
                <TabsTrigger value="results">
                  <Radio className="w-3.5 h-3.5 mr-1.5" />
                  历史
                </TabsTrigger>
                <TabsTrigger value="stats">
                  <BarChart3 className="w-3.5 h-3.5 mr-1.5" />
                  统计
                </TabsTrigger>
                <TabsTrigger value="schedule">
                  <CalendarClock className="w-3.5 h-3.5 mr-1.5" />
                  定时
                </TabsTrigger>
                <TabsTrigger value="settings">
                  <Settings className="w-3.5 h-3.5 mr-1.5" />
                  设置
                </TabsTrigger>
              </TabsList>

              <TabsContent value="test">
                {providers.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-24 text-muted-foreground">
                    <FlaskConical className="w-12 h-12 mb-4 opacity-30" />
                    <p className="text-sm">先在左侧添加服务商并检测模型</p>
                  </div>
                ) : (
                  <div className="space-y-6">
                    <ModelSelector
                      groups={providers}
                      selectedKeys={new Set(selectedTests.keys())}
                      onToggle={toggleTestItem}
                      onToggleAll={toggleAllForProvider}
                    />
                    {selectedTests.size > 0 && (
                      <SpeedTestForm
                        selectedCount={selectedTests.size}
                        providerCount={
                          new Set(
                            Array.from(selectedTests.keys()).map((k) => k.split("|")[0])
                          ).size
                        }
                        onRunTest={handleRunTest}
                        running={running}
                      />
                    )}
                    {progress && (
                      <SpeedTestProgress
                        completed={progress.completed}
                        total={progress.total}
                        results={progress.results}
                        cancelled={cancelled}
                        onCancel={handleCancel}
                        onShowResults={handleShowResults}
                        providers={providers}
                      />
                    )}
                    <RunResults results={results} providers={providers} />
                  </div>
                )}
              </TabsContent>

              <TabsContent value="results">
                <HistoryList refreshKey={refreshKey} providers={providers} />
              </TabsContent>

              <TabsContent value="stats">
                <StatsPanel refreshKey={refreshKey} providers={providers} />
              </TabsContent>

              <TabsContent value="schedule">
                <SchedulePanel providers={providers} />
              </TabsContent>

              <TabsContent value="settings">
                <SettingsPanel />
              </TabsContent>
            </Tabs>
          </div>
        </main>
      </div>

      <footer className="border-t border-border/50 shrink-0">
        <div className="max-w-screen-2xl mx-auto px-4 py-3 text-center text-xs text-muted-foreground">
          Token Speed v1.0.0
        </div>
      </footer>
    </div>
  );
}
