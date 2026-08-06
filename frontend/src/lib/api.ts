import type {
  ConnectResponse,
  SpeedTestResult,
  BatchResponse,
  TestHistory,
  StatsResponse,
  ProviderListResponse,
  Provider,
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
  apiKey: string
): Promise<ConnectResponse> {
  return request("/connect", {
    method: "POST",
    body: JSON.stringify({ base_url: baseUrl, api_key: apiKey }),
  });
}

export async function runSpeedTest(params: {
  base_url: string;
  api_key: string;
  model: string;
  prompt: string;
  max_tokens: number;
  temperature: number;
  stream: boolean;
}): Promise<SpeedTestResult> {
  return request("/speed-test", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

export async function runBatchSpeedTest(params: {
  tests: { model: string; base_url: string; api_key: string }[];
  prompt: string;
  max_tokens: number;
  temperature: number;
  concurrency: number;
  iterations: number;
  stream: boolean;
}): Promise<BatchResponse> {
  return request("/speed-test/batch", {
    method: "POST",
    body: JSON.stringify(params),
  });
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
  models?: string[];
}): Promise<Provider> {
  return request("/providers", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updateProvider(
  id: string,
  data: { name: string; base_url: string; api_key: string; models?: string[] | null }
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
