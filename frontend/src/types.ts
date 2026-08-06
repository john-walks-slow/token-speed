export interface ModelInfo {
  id: string;
  owned_by: string;
}

export interface ConnectResponse {
  success: boolean;
  models: ModelInfo[];
  error?: string;
}

export interface SpeedTestResult {
  id: string;
  base_url: string;
  model: string;
  actual_model: string;
  prompt: string;
  max_tokens: number;
  temperature: number;
  ttft_ms: number | null;
  content_ttft_ms: number | null;
  total_latency_ms: number;
  tokens_generated: number;
  reasoning_tokens: number;
  content_tokens: number;
  tps: number;
  tpm: number;
  success: boolean;
  error_message: string | null;
  created_at: string;
}

export interface BatchSummary {
  total_tests: number;
  successful: number;
  failed: number;
  avg_tps: number;
  avg_tpm: number;
  avg_latency_ms: number;
  best_model: string;
  best_tps: number;
}

export interface SpeedTestItem {
  model: string;
  base_url: string;
  api_key: string;
}

export interface BatchResponse {
  results: SpeedTestResult[];
  summary: BatchSummary;
}

export interface TestHistory {
  id: string;
  base_url: string;
  model: string;
  actual_model: string;
  ttft_ms: number | null;
  content_ttft_ms: number | null;
  total_latency_ms: number;
  tokens_generated: number;
  reasoning_tokens: number;
  content_tokens: number;
  tps: number;
  tpm: number;
  success: boolean;
  created_at: string;
}

export interface StatsResponse {
  total_tests: number;
  success_rate: number;
  avg_tps: number;
  avg_tpm: number;
  avg_latency_ms: number;
  avg_ttft_ms: number | null;
  tests_by_model: {
    model: string;
    count: number;
    avg_tps: number;
    avg_latency: number;
  }[];
  recent_tests: TestHistory[];
}

// ── Provider ──────────────────────────────────────────────────

export interface Provider {
  id: string;
  name: string;
  base_url: string;
  api_key: string;
  models: string[];
  created_at: string;
  updated_at: string;
}

export interface ProviderListResponse {
  providers: Provider[];
}

