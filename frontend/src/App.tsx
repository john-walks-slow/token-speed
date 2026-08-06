import { useState, useEffect, useCallback } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import ConnectionConfig from "@/components/ConnectionConfig";
import ModelSelector from "@/components/ModelSelector";
import SpeedTestForm from "@/components/SpeedTestForm";
import SpeedTestResults from "@/components/SpeedTestResults";
import HistoryList from "@/components/HistoryList";
import StatsPanel from "@/components/StatsPanel";
import { runBatchSpeedTest, getProviders } from "@/lib/api";
import type { Provider, SpeedTestResult, BatchSummary, SpeedTestItem } from "@/types";
import {
  Gauge,
  BarChart3,
  Activity,
  Radio,
  PanelLeftOpen,
  PanelLeftClose,
  FlaskConical,
} from "lucide-react";

export default function App() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [selectedTests, setSelectedTests] = useState<Map<string, SpeedTestItem>>(new Map());
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<SpeedTestResult[]>([]);
  const [summary, setSummary] = useState<BatchSummary | undefined>();
  const [refreshKey, setRefreshKey] = useState(0);
  const [tab, setTab] = useState("test");
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

  const toggleTestItem = useCallback(
    (providerId: string, model: string, baseUrl: string, apiKey: string) => {
      const key = `${providerId}|${model}`;
      setSelectedTests((prev) => {
        const next = new Map(prev);
        if (next.has(key)) {
          next.delete(key);
        } else {
          next.set(key, { model, base_url: baseUrl, api_key: apiKey });
        }
        return next;
      });
    },
    []
  );

  const toggleAllForProvider = useCallback(
    (providerId: string, models: string[], baseUrl: string, apiKey: string, select: boolean) => {
      setSelectedTests((prev) => {
        const next = new Map(prev);
        for (const m of models) {
          const key = `${providerId}|${m}`;
          if (select) {
            next.set(key, { model: m, base_url: baseUrl, api_key: apiKey });
          } else {
            next.delete(key);
          }
        }
        return next;
      });
    },
    []
  );

  const handleRunTest = useCallback(
    async (params: {
      prompt: string;
      maxTokens: number;
      temperature: number;
      concurrency: number;
      iterations: number;
      stream: boolean;
    }) => {
      const tests = Array.from(selectedTests.values());
      if (tests.length === 0) return;
      setRunning(true);
      setResults([]);
      setSummary(undefined);
      try {
        const res = await runBatchSpeedTest({
          tests,
          prompt: params.prompt,
          max_tokens: params.maxTokens,
          temperature: params.temperature,
          concurrency: params.concurrency,
          iterations: params.iterations,
          stream: params.stream,
        });
        setResults(res.results);
        setSummary(res.summary);
        setRefreshKey((k) => k + 1);
        setTab("results");
      } catch (e) {
        setResults([
          {
            id: "error",
            base_url: "",
            model: "error",
            prompt: "",
            max_tokens: 0,
            temperature: 0,
            ttft_ms: null,
            total_latency_ms: 0,
            tokens_generated: 0,
            tps: 0,
            tpm: 0,
            success: false,
            error_message: e instanceof Error ? e.message : "测试失败",
            created_at: new Date().toISOString(),
          },
        ]);
      } finally {
        setRunning(false);
      }
    },
    [selectedTests]
  );

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border/50 sticky top-0 z-30 bg-background/80 backdrop-blur-md">
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

      <div className="max-w-screen-2xl mx-auto flex">
        {/* Sidebar — provider management */}
        <aside
          className={`hidden lg:flex flex-col border-r border-border/50 h-[calc(100vh-57px)] sticky top-[57px] transition-all duration-200 overflow-hidden shrink-0 ${
            sidebarOpen ? "w-80" : "w-0 border-r-0"
          }`}
        >
          <div className={`flex-1 overflow-y-auto p-4 ${sidebarOpen ? "block" : "hidden"}`}>
            <ConnectionConfig onProvidersChange={handleProvidersChange} />
          </div>
        </aside>

        {/* Main content */}
        <main className="flex-1 min-w-0">
          {/* Mobile: provider panel at top */}
          <div className="lg:hidden p-4 border-b border-border/30">
            <ConnectionConfig onProvidersChange={handleProvidersChange} />
          </div>

          <div className="p-4 lg:p-6">
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList className="w-full sm:w-auto grid grid-cols-3 sm:inline-flex">
                <TabsTrigger value="test">
                  <Gauge className="w-3.5 h-3.5 mr-1.5" />
                  测速
                </TabsTrigger>
                <TabsTrigger value="results">
                  <Radio className="w-3.5 h-3.5 mr-1.5" />
                  结果
                </TabsTrigger>
                <TabsTrigger value="stats">
                  <BarChart3 className="w-3.5 h-3.5 mr-1.5" />
                  统计
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
                      providers={providers}
                      selected={selectedTests}
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
                  </div>
                )}
              </TabsContent>

              <TabsContent value="results">
                <div className="space-y-6">
                  <SpeedTestResults results={results} summary={summary} />
                  <HistoryList refreshKey={refreshKey} />
                </div>
              </TabsContent>

              <TabsContent value="stats">
                <StatsPanel refreshKey={refreshKey} />
              </TabsContent>
            </Tabs>
          </div>
        </main>
      </div>

      <footer className="border-t border-border/50">
        <div className="max-w-screen-2xl mx-auto px-4 py-3 text-center text-xs text-muted-foreground">
          Token Speed v1.0.0
        </div>
      </footer>
    </div>
  );
}
