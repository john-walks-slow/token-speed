import asyncio
import json
import os
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import FastAPI, HTTPException, Query, APIRouter
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .database import (
    insert_speed_test, get_all_tests, get_test_by_id, delete_test, delete_all_tests, get_stats,
    list_providers, get_provider, create_provider, update_provider, delete_provider,
    save_provider_models,
    list_schedules, get_schedule, create_schedule, update_schedule, delete_schedule,
    set_schedule_enabled,
)
from .models import (
    ConnectRequest,
    ConnectResponse,
    SpeedTestRequest,
    BatchSpeedTestRequest,
    BatchSpeedTestItem,
    SpeedTestResult,
    SpeedTestHistory,
    StatsResponse,
    ProviderCreate,
    ProviderUpdate,
    ProviderModelsUpdate,
    ProviderResponse,
    ProviderListResponse,
    NetworkSettings,
    ScheduleCreate,
    ScheduleUpdate,
    ScheduleTarget,
    ScheduleResponse,
)
from .scheduler import SpeedTestScheduler
from .speed_test import list_models, run_speed_test
from .rate_limit import limiter
from .security import admin_password, AdminAuthMiddleware
from . import autostart, paths, network_settings as net_settings


scheduler = SpeedTestScheduler()


@asynccontextmanager
async def lifespan(app: FastAPI):
    await scheduler.start()
    yield
    await scheduler.stop()


app = FastAPI(title="Token Speed", version="1.0.0", lifespan=lifespan)

# 路由拆分：read_router（只读集）供主应用与独立看板 app 共享；
# admin_router（管理集）仅主应用挂载，由 AdminAuthMiddleware 保护。
read_router = APIRouter()
admin_router = APIRouter()

# 本机工具：CORS 仅放行 localhost/127.0.0.1 各端口（开发 5173、桌面动态端口、旧 preview）
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
# 管理密码：配置后拦截 /api 下非只读请求；静态资源与只读集不拦截
app.add_middleware(AdminAuthMiddleware)


@admin_router.post("/api/connect", response_model=ConnectResponse)
async def connect(req: ConnectRequest):
    success, result = await list_models(req.base_url, req.api_key, req.protocol)
    if success:
        return ConnectResponse(success=True, models=result)
    return ConnectResponse(success=False, error=str(result))


@admin_router.post("/api/speed-test", response_model=SpeedTestResult)
async def speed_test(req: SpeedTestRequest):
    result = await run_speed_test(
        base_url=req.base_url,
        api_key=req.api_key,
        model=req.model,
        prompt=req.prompt,
        max_tokens=req.max_tokens,
        temperature=req.temperature,
        stream=req.stream,
        protocol=req.protocol,
    )
    await insert_speed_test(result)
    return SpeedTestResult(**result)


class BatchSummary(BaseModel):
    total_tests: int
    successful: int
    failed: int
    avg_tps: float
    avg_latency_ms: float
    best_model: str = ""
    best_tps: float = 0


class BatchSpeedTestResponse(BaseModel):
    results: list[SpeedTestResult]
    summary: BatchSummary


def _expand_tests(req: BatchSpeedTestRequest) -> list[BatchSpeedTestItem]:
    """按 provider 分桶，桶内按模型 round-robin 展开为 iterations 轮。

    同一 provider 的各模型在同一轮里依次排列，跨 provider 独立；展开顺序只影响
    任务进入信号量的先后，配合 per-provider 信号量实现各模型均衡压力。
    """
    buckets: dict[tuple[str, str], list[BatchSpeedTestItem]] = {}
    for item in req.tests:
        buckets.setdefault((item.base_url, item.api_key), []).append(item)
    items: list[BatchSpeedTestItem] = []
    for bucket in buckets.values():
        for _ in range(req.iterations):
            items.extend(bucket)
    return items


def _to_error_result(item: BatchSpeedTestItem, req: BatchSpeedTestRequest, error: BaseException, now_iso: str) -> dict:
    return {
        "id": str(uuid.uuid4()),
        "base_url": item.base_url,
        "model": item.model,
        "actual_model": "error",
        "provider_id": item.provider_id,
        "provider_name": item.provider_name,
        "response_content": None,
        "content_ttft_ms": None,
        "reasoning_tokens": 0,
        "content_tokens": 0,
        "input_tokens": 0,
        "prompt": req.prompt,
        "max_tokens": req.max_tokens,
        "temperature": req.temperature,
        "ttft_ms": None,
        "total_latency_ms": 0,
        "tokens_generated": 0,
        "thinking_ms": None,
        "tps": None,
        "success": False,
        "error_message": str(error),
        "created_at": now_iso,
    }


def _median(values: list[float]) -> float:
    if not values:
        return 0.0
    s = sorted(values)
    n = len(s)
    mid = n // 2
    if n % 2:
        return s[mid]
    return (s[mid - 1] + s[mid]) / 2


def compute_summary(parsed: list[SpeedTestResult]) -> BatchSummary:
    """按 (base_url, model) 分组成功样本，组内取 median(P50) 作为该模型代表值。

    速度/延迟在长尾下用 median 比 mean 稳定；失败样本不计入。
    """
    successful = [r for r in parsed if r.success]

    groups: dict[tuple[str, str], list[SpeedTestResult]] = {}
    for r in successful:
        if r.tps is None:
            continue  # 无有效速度样本（如零 token 产出）不参与速度汇总
        groups.setdefault((r.base_url, r.model), []).append(r)

    reps = []
    for (base_url, model), rs in groups.items():
        reps.append({
            "base_url": base_url,
            "model": model,
            "tps": _median([r.tps for r in rs]),
            "latency_ms": _median([r.total_latency_ms for r in rs]),
        })

    if reps:
        avg_tps = sum(r["tps"] for r in reps) / len(reps)
        avg_lat = sum(r["latency_ms"] for r in reps) / len(reps)
        best = max(reps, key=lambda r: r["tps"])
        best_model = best["model"]
        best_tps = best["tps"]
        best_base_url = best["base_url"]
    else:
        # 无速度样本（如全部零 token）：avg_tps/best_tps 置 None，前端显示 N/A，而非误显示 0
        avg_tps = None
        avg_lat = sum(r.total_latency_ms for r in successful) / len(successful) if successful else 0
        best_model = ""
        best_tps = None
        best_base_url = ""

    return BatchSummary(
        total_tests=len(parsed),
        successful=len(successful),
        failed=len(parsed) - len(successful),
        avg_tps=round(avg_tps, 2) if avg_tps is not None else None,
        avg_latency_ms=round(avg_lat, 2),
        best_model=best_model,
        best_tps=round(best_tps, 2) if best_tps is not None else None,
        best_base_url=best_base_url,
    )


async def _iter_batch_results(req: BatchSpeedTestRequest, sink=None):
    """Run all tests, yielding each result as it completes.

    并发按 provider(base_url+api_key) 分桶，每桶独立 Semaphore(req.concurrency)，
    不同 provider 互不挤占。异常按 item 兜底为 error result。SSE 客户端提前断开时
    取消剩余任务。

    sink：可选的逐条落地回调（每条结果完成后调用），由调用方注入数据去向。
    core 层不感知数据存储方式。
    """
    now_iso = datetime.now(timezone.utc).isoformat()
    items = _expand_tests(req)
    semaphores: dict[tuple[str, str], asyncio.Semaphore] = {}
    for it in items:
        key = (it.base_url, it.api_key)
        semaphores.setdefault(key, asyncio.Semaphore(req.concurrency))

    async def run_one(item):
        key = (item.base_url, item.api_key)
        sem = semaphores[key]
        await limiter.acquire(key, req.max_rpm)
        async with sem:
            try:
                r = await run_speed_test(
                    base_url=item.base_url,
                    api_key=item.api_key,
                    model=item.model,
                    prompt=req.prompt,
                    max_tokens=req.max_tokens,
                    temperature=req.temperature,
                    stream=req.stream,
                    provider_id=item.provider_id,
                    provider_name=item.provider_name,
                    protocol=item.protocol,
                )
            except Exception as e:
                r = _to_error_result(item, req, e, now_iso)
            if sink is not None:
                await sink(r)
            return r

    tasks = [asyncio.create_task(run_one(item)) for item in items]
    try:
        for coro in asyncio.as_completed(tasks):
            yield await coro
    finally:
        for t in tasks:
            if not t.done():
                t.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)


@admin_router.post("/api/speed-test/batch", response_model=BatchSpeedTestResponse)
async def batch_speed_test(req: BatchSpeedTestRequest):
    async def sqlite_sink(r: dict) -> None:
        await insert_speed_test(r)

    results = [r async for r in _iter_batch_results(req, sqlite_sink)]

    parsed = [SpeedTestResult(**r) for r in results]
    return BatchSpeedTestResponse(results=parsed, summary=compute_summary(parsed))


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


@admin_router.post("/api/speed-test/batch-stream")
async def batch_speed_test_stream(req: BatchSpeedTestRequest):
    total = len(req.tests) * req.iterations

    async def sqlite_sink(r: dict) -> None:
        await insert_speed_test(r)

    async def event_stream():
        results = []
        async for result in _iter_batch_results(req, sqlite_sink):
            results.append(result)
            yield _sse("progress", {"index": len(results), "total": total, "result": result})

        parsed = [SpeedTestResult(**r) for r in results]
        yield _sse("summary", {"results": results, "summary": compute_summary(parsed).model_dump()})

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@read_router.get("/api/history", response_model=list[SpeedTestHistory])
async def history(limit: int = Query(default=50, le=500), offset: int = Query(default=0)):
    tests = await get_all_tests(limit=limit, offset=offset)
    return [SpeedTestHistory(**t) for t in tests]


@read_router.get("/api/history/{test_id}", response_model=SpeedTestResult | None)
async def history_detail(test_id: str):
    test = await get_test_by_id(test_id)
    if test is None:
        return None
    return SpeedTestResult(**test)


@admin_router.delete("/api/history/{test_id}")
async def remove_test(test_id: str):
    ok = await delete_test(test_id)
    if not ok:
        raise HTTPException(404, "Test not found")
    return {"message": "Test deleted"}


@admin_router.delete("/api/history")
async def clear_history():
    await delete_all_tests()
    return {"message": "History cleared"}


@read_router.get("/api/mode")
async def mode():
    """主应用模式标识（单端口，始终 full）。"""
    return {"mode": "full"}


@read_router.get("/api/auth/status")
async def auth_status():
    """前端判断是否需登录门：是否已配置管理密码。"""
    return {"required": bool(admin_password())}


@read_router.get("/api/providers/public", response_model=ProviderListResponse)
async def get_providers_public():
    """sanitize 版 providers：仅供匿名只读统计视图（分组/命名/标签），api_key 一律清空。"""
    providers = [ProviderResponse(**p) for p in await list_providers()]
    for p in providers:
        p.api_key = ""
    return ProviderListResponse(providers=providers)


@read_router.get("/api/stats", response_model=StatsResponse)
async def stats():
    return await get_stats()


# ── Provider CRUD ──────────────────────────────────────────────


@admin_router.get("/api/providers", response_model=ProviderListResponse)
async def get_providers():
    providers = await list_providers()
    return ProviderListResponse(providers=[ProviderResponse(**p) for p in providers])


@admin_router.post("/api/providers", response_model=ProviderResponse, status_code=201)
async def add_provider(req: ProviderCreate):
    p = await create_provider(req.name, req.base_url, req.api_key, req.models if req.models else None, protocol=req.protocol)
    return ProviderResponse(**p)


@admin_router.put("/api/providers/{provider_id}", response_model=ProviderResponse)
async def edit_provider(provider_id: str, req: ProviderUpdate):
    p = await update_provider(provider_id, req.name, req.base_url, req.api_key, models=req.models, protocol=req.protocol)
    if p is None:
        raise HTTPException(404, "Provider not found")
    return ProviderResponse(**p)


@admin_router.put("/api/providers/{provider_id}/models", response_model=ProviderResponse)
async def update_provider_models(provider_id: str, req: ProviderModelsUpdate):
    p = await save_provider_models(provider_id, req.models)
    if p is None:
        raise HTTPException(404, "Provider not found")
    return ProviderResponse(**p)


@admin_router.delete("/api/providers/{provider_id}")
async def remove_provider(provider_id: str):
    ok = await delete_provider(provider_id)
    if not ok:
        raise HTTPException(404, "Provider not found")
    return {"message": "Provider deleted"}


# ── Schedule CRUD ─────────────────────────────────────────────


def _schedule_response(s: dict) -> ScheduleResponse:
    return ScheduleResponse(
        id=s["id"],
        name=s["name"] or "",
        enabled=bool(s["enabled"]),
        interval_minutes=s["interval_minutes"],
        targets=[ScheduleTarget(**t) for t in s.get("targets", [])],
        prompt=s.get("prompt") or "",
        max_tokens=s.get("max_tokens"),
        temperature=s.get("temperature"),
        stream=bool(s.get("stream")),
        concurrency=s.get("concurrency") or 1,
        iterations=s.get("iterations") or 1,
        max_rpm=s.get("max_rpm") if s.get("max_rpm") is not None else -1,
        created_at=s.get("created_at") or "",
        updated_at=s.get("updated_at") or "",
        last_run_at=s.get("last_run_at"),
        next_run_at=s.get("next_run_at"),
        last_run_status=s.get("last_run_status"),
        run_total=s.get("run_total") or 0,
        run_done=s.get("run_done") or 0,
        run_success=s.get("run_success") or 0,
    )


@read_router.get("/api/schedules", response_model=list[ScheduleResponse])
async def get_schedules():
    schedules = await list_schedules()
    return [_schedule_response(s) for s in schedules]


@admin_router.post("/api/schedules", response_model=ScheduleResponse, status_code=201)
async def add_schedule(req: ScheduleCreate):
    s = await create_schedule(
        name=req.name,
        interval_minutes=req.interval_minutes,
        targets=[t.model_dump() for t in req.targets],
        prompt=req.prompt,
        max_tokens=req.max_tokens,
        temperature=req.temperature,
        stream=req.stream,
        concurrency=req.concurrency,
        iterations=req.iterations,
        max_rpm=req.max_rpm,
    )
    return _schedule_response(s)


@admin_router.put("/api/schedules/{schedule_id}", response_model=ScheduleResponse)
async def edit_schedule(schedule_id: str, req: ScheduleUpdate):
    # model_dump 已把 ScheduleTarget 转成 dict，无需再 model_dump
    fields = req.model_dump(exclude_unset=True)
    s = await update_schedule(schedule_id, fields)
    if s is None:
        raise HTTPException(404, "Schedule not found")
    return _schedule_response(s)


@admin_router.delete("/api/schedules/{schedule_id}")
async def remove_schedule(schedule_id: str):
    ok = await delete_schedule(schedule_id)
    if not ok:
        raise HTTPException(404, "Schedule not found")
    return {"message": "Schedule deleted"}


@admin_router.put("/api/schedules/{schedule_id}/toggle", response_model=ScheduleResponse)
async def toggle_schedule(schedule_id: str, enabled: bool = Query(...)):
    s = await set_schedule_enabled(schedule_id, enabled)
    if s is None:
        raise HTTPException(404, "Schedule not found")
    return _schedule_response(s)


@admin_router.post("/api/schedules/{schedule_id}/run", response_model=ScheduleResponse)
async def run_schedule_now(schedule_id: str):
    if scheduler.is_running(schedule_id):
        raise HTTPException(409, "Schedule is already running")
    s = await get_schedule(schedule_id)
    if s is None:
        raise HTTPException(404, "Schedule not found")
    scheduler.spawn_run(schedule_id, advance_next=False)
    return _schedule_response(s)


# ── Settings（桌面）────────────────────────────────────────────


class AutostartSettings(BaseModel):
    supported: bool
    enabled: bool


@admin_router.get("/api/settings/autostart", response_model=AutostartSettings)
async def get_autostart():
    return AutostartSettings(supported=autostart.supported(), enabled=autostart.is_enabled())


class AutostartUpdate(BaseModel):
    enabled: bool


@admin_router.put("/api/settings/autostart", response_model=AutostartSettings)
async def set_autostart(req: AutostartUpdate):
    if not autostart.supported():
        return AutostartSettings(supported=False, enabled=False)
    ok = autostart.set_enabled(req.enabled)
    return AutostartSettings(supported=True, enabled=req.enabled if ok else autostart.is_enabled())


@admin_router.get("/api/settings/network", response_model=NetworkSettings)
async def get_network():
    return NetworkSettings(**net_settings.get_network_settings())


@admin_router.put("/api/settings/network", response_model=NetworkSettings)
async def set_network(req: NetworkSettings):
    try:
        data = await net_settings.update_network_settings(req.model_dump())
    except ValueError as e:
        raise HTTPException(400, str(e))
    return NetworkSettings(**data)


# 路由挂载：只读集共享（看板 app 只挂 read_router），管理集仅主应用
app.include_router(read_router)
app.include_router(admin_router)


# ── 前端静态资源（桌面/已构建场景）─────────────────────────────
# 放在所有 /api 路由之后，SPA 路由回落由 StaticFiles(html=True) 处理


def mount_frontend() -> None:
    if not paths.frontend_dist_exists():
        return
    app.mount("/", StaticFiles(directory=paths.frontend_dist_dir(), html=True), name="frontend")


mount_frontend()
