import type {
  ConnectResponse,
  SpeedTestResult,
  TestHistory,
  StatsResponse,
  ProviderListResponse,
  Provider,
  Schedule,
  ScheduleCreate,
  ScheduleUpdate,
  AutostartSettings,
  NetworkSettings,
} from "../types";

const BASE = "/api";

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${url}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error (${res.status}): ${text}`);
  }
  return res.json();
}

export async function connect(
  baseUrl: string,
  apiKey: string,
  protocol = "openai"
): Promise<ConnectResponse> {
  return request("/connect", {
    method: "POST",
    body: JSON.stringify({ base_url: baseUrl, api_key: apiKey, protocol }),
  });
}

export interface SpeedTestProgressEvent {
  index: number;
  total: number;
  result: SpeedTestResult;
}

export interface StreamHandlers {
  onProgress?: (event: SpeedTestProgressEvent) => void;
}

/**
 * Streams batch speed test results over SSE. Each completed test fires
 * onProgress. Rejects on transport error (abort signal included).
 */
export async function streamBatchSpeedTest(
  params: {
    tests: { model: string; base_url: string; api_key: string; protocol?: string }[];
    prompt: string;
    max_tokens: number;
    temperature: number;
    concurrency: number;
    iterations: number;
    stream: boolean;
    max_rpm?: number;
  },
  handlers: StreamHandlers,
  signal?: AbortSignal
): Promise<void> {
  const res = await fetch(`${BASE}/speed-test/batch-stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify(params),
    signal,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error (${res.status}): ${text}`);
  }
  if (!res.body) throw new Error("Response body missing");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const dispatch = (event: string, data: string) => {
    if (event === "progress") {
      handlers.onProgress?.(JSON.parse(data) as SpeedTestProgressEvent);
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let sep: number;
    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      const block = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      let event = "message";
      let data = "";
      for (const line of block.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data = line.slice(5).trim();
      }
      if (data) dispatch(event, data);
    }
  }
}

export async function getHistory(
  limit = 50,
  offset = 0
): Promise<TestHistory[]> {
  return request(`/history?limit=${limit}&offset=${offset}`);
}

export async function getHistoryDetail(
  id: string
): Promise<SpeedTestResult | null> {
  return request(`/history/${id}`);
}

export async function deleteHistoryItem(id: string): Promise<void> {
  await request(`/history/${id}`, { method: "DELETE" });
}

export async function clearHistory(): Promise<void> {
  await request("/history", { method: "DELETE" });
}

export async function getStats(): Promise<StatsResponse> {
  return request("/stats");
}

// ── Provider API ──────────────────────────────────────────────

export async function getProviders(): Promise<ProviderListResponse> {
  return request("/providers");
}

export async function createProvider(data: {
  name: string;
  base_url: string;
  api_key: string;
  protocol?: "openai" | "anthropic";
  models?: string[];
}): Promise<Provider> {
  return request("/providers", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updateProvider(
  id: string,
  data: {
    name: string;
    base_url: string;
    api_key: string;
    protocol?: "openai" | "anthropic";
    models?: string[] | null;
  }
): Promise<Provider> {
  return request(`/providers/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export async function deleteProvider(id: string): Promise<void> {
  await request(`/providers/${id}`, { method: "DELETE" });
}

export async function updateProviderModels(
  id: string,
  models: string[]
): Promise<Provider> {
  return request(`/providers/${id}/models`, {
    method: "PUT",
    body: JSON.stringify({ models }),
  });
}

// ── Schedule API ───────────────────────────────────────────────

export async function getSchedules(): Promise<Schedule[]> {
  return request("/schedules");
}

export async function createSchedule(
  data: ScheduleCreate
): Promise<Schedule> {
  return request("/schedules", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updateSchedule(
  id: string,
  data: ScheduleUpdate
): Promise<Schedule> {
  return request(`/schedules/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export async function deleteSchedule(id: string): Promise<void> {
  await request(`/schedules/${id}`, { method: "DELETE" });
}

export async function toggleSchedule(
  id: string,
  enabled: boolean
): Promise<Schedule> {
  return request(`/schedules/${id}/toggle?enabled=${enabled}`, {
    method: "PUT",
  });
}

export async function runScheduleNow(id: string): Promise<Schedule> {
  return request(`/schedules/${id}/run`, { method: "POST" });
}

// ── Settings API ──────────────────────────────────────────────

export async function getAutostart(): Promise<AutostartSettings> {
  return request("/settings/autostart");
}

export async function setAutostart(enabled: boolean): Promise<AutostartSettings> {
  return request("/settings/autostart", {
    method: "PUT",
    body: JSON.stringify({ enabled }),
  });
}

// ── Network Settings API ─────────────────────────────────────

export async function getNetworkSettings(): Promise<NetworkSettings> {
  return request("/settings/network");
}

export async function setNetworkSettings(
  data: NetworkSettings
): Promise<NetworkSettings> {
  return request("/settings/network", {
    method: "PUT",
    body: JSON.stringify(data),
  });
}
