from pydantic import BaseModel
from typing import Literal, Optional
from datetime import datetime


class ConnectRequest(BaseModel):
    base_url: str
    api_key: str = ""
    protocol: str = "openai"


class ModelInfo(BaseModel):
    id: str
    owned_by: str = "unknown"


class ConnectResponse(BaseModel):
    success: bool
    models: list[ModelInfo] = []
    error: Optional[str] = None


class SpeedTestRequest(BaseModel):
    base_url: str
    api_key: str = ""
    model: str
    prompt: str = "Hello, tell me a short story in 3 sentences."
    max_tokens: Optional[int] = None
    temperature: float = 0.7
    stream: bool = False
    protocol: str = "openai"


class BatchSpeedTestItem(BaseModel):
    model: str
    base_url: str
    api_key: str = ""
    provider_id: str = ""
    provider_name: str = ""
    protocol: str = "openai"


class BatchSpeedTestRequest(BaseModel):
    tests: list[BatchSpeedTestItem]
    prompt: str = "Hello, tell me a short story in 3 sentences."
    max_tokens: Optional[int] = None
    temperature: float = 0.7
    concurrency: int = 1
    iterations: int = 1
    stream: bool = False
    max_rpm: int = -1


class SpeedTestResult(BaseModel):
    id: str
    base_url: str
    model: str
    actual_model: str = ""
    provider_id: Optional[str] = None
    provider_name: Optional[str] = None
    response_content: Optional[str] = None
    prompt: str
    max_tokens: int
    temperature: float
    ttft_ms: Optional[float] = None
    content_ttft_ms: Optional[float] = None
    total_latency_ms: float
    tokens_generated: int
    reasoning_tokens: int = 0
    content_tokens: int = 0
    thinking_ms: Optional[float] = None
    tps: Optional[float] = None
    success: bool
    error_message: Optional[str] = None
    created_at: str = ""


class BatchSummary(BaseModel):
    total_tests: int
    successful: int
    failed: int
    avg_tps: Optional[float] = None  # None = 无速度样本（如全 non-stream）
    avg_latency_ms: float
    best_model: str = ""
    best_tps: Optional[float] = None
    best_base_url: str = ""  # 同 model 多 provider 时用于精确匹配


class SpeedTestHistory(BaseModel):
    id: str
    base_url: str
    model: str
    actual_model: str = ""
    provider_id: Optional[str] = None
    provider_name: Optional[str] = None
    response_content: Optional[str] = None
    ttft_ms: Optional[float]
    content_ttft_ms: Optional[float] = None
    total_latency_ms: float
    tokens_generated: int
    reasoning_tokens: int = 0
    content_tokens: int = 0
    thinking_ms: Optional[float] = None
    tps: Optional[float] = None
    success: bool
    created_at: str
    schedule_id: Optional[str] = None


class StatsResponse(BaseModel):
    total_tests: int
    success_rate: float
    avg_tps: float
    avg_latency_ms: float
    avg_ttft_ms: Optional[float]
    tests_by_model: list[dict]
    recent_tests: list[SpeedTestHistory]


# ── Provider ───────────────────────────────────────────────────


class ProviderCreate(BaseModel):
    name: str
    base_url: str
    api_key: str = ""
    protocol: Literal["openai", "anthropic"] = "openai"
    models: list[str] = []


class ProviderUpdate(BaseModel):
    name: str
    base_url: str
    api_key: str = ""
    protocol: Literal["openai", "anthropic"] = "openai"
    models: list[str] | None = None


class ProviderModelsUpdate(BaseModel):
    models: list[str]


class ProviderResponse(BaseModel):
    id: str
    name: str
    base_url: str
    api_key: str = ""
    protocol: Literal["openai", "anthropic"] = "openai"
    models: list[str] = []
    created_at: str = ""
    updated_at: str = ""


class ProviderListResponse(BaseModel):
    providers: list[ProviderResponse]


# ── Network Settings ───────────────────────────────────────────


class NetworkSettings(BaseModel):
    proxy_mode: Literal["system", "custom", "none"] = "system"
    custom_proxy: str = ""
    verify_ssl: bool = True


# ── Schedule ───────────────────────────────────────────────────


class ScheduleTarget(BaseModel):
    provider_id: str
    models: list[str]


class ScheduleCreate(BaseModel):
    name: str = ""
    interval_minutes: int
    targets: list[ScheduleTarget]
    prompt: str = "Hello, tell me a short story in 3 sentences."
    max_tokens: Optional[int] = None
    temperature: float = 0.7
    stream: bool = True
    concurrency: int = 1
    iterations: int = 1
    max_rpm: int = -1


class ScheduleUpdate(BaseModel):
    name: Optional[str] = None
    interval_minutes: Optional[int] = None
    targets: Optional[list[ScheduleTarget]] = None
    prompt: Optional[str] = None
    max_tokens: Optional[int] = None
    temperature: Optional[float] = None
    stream: Optional[bool] = None
    concurrency: Optional[int] = None
    iterations: Optional[int] = None
    max_rpm: Optional[int] = None


class ScheduleResponse(BaseModel):
    id: str
    name: str = ""
    enabled: bool = True
    interval_minutes: int
    targets: list[ScheduleTarget] = []
    prompt: str = ""
    max_tokens: Optional[int] = None
    temperature: float = 0.7
    stream: bool = True
    concurrency: int = 1
    iterations: int = 1
    max_rpm: int = -1
    created_at: str = ""
    updated_at: str = ""
    last_run_at: Optional[str] = None
    next_run_at: Optional[str] = None
    last_run_status: Optional[str] = None
    run_total: int = 0
    run_done: int = 0
    run_success: int = 0

