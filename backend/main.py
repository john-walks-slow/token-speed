from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .database import (
    insert_speed_test, get_all_tests, get_test_by_id, delete_test, delete_all_tests, get_stats,
    list_providers, get_provider, create_provider, update_provider, delete_provider,
    save_provider_models,
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
)
from .speed_test import list_models, run_speed_test


app = FastAPI(title="Token Speed", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.post("/api/connect", response_model=ConnectResponse)
async def connect(req: ConnectRequest):
    success, result = await list_models(req.base_url, req.api_key)
    if success:
        return ConnectResponse(success=True, models=result)
    return ConnectResponse(success=False, error=str(result))


@app.post("/api/speed-test", response_model=SpeedTestResult)
async def speed_test(req: SpeedTestRequest):
    result = await run_speed_test(
        base_url=req.base_url,
        api_key=req.api_key,
        model=req.model,
        prompt=req.prompt,
        max_tokens=req.max_tokens,
        temperature=req.temperature,
        stream=req.stream,
    )
    await insert_speed_test(result)
    return SpeedTestResult(**result)


class BatchSummary(BaseModel):
    total_tests: int
    successful: int
    failed: int
    avg_tps: float
    avg_tpm: float
    avg_latency_ms: float
    best_model: str = ""
    best_tps: float = 0


class BatchSpeedTestResponse(BaseModel):
    results: list[SpeedTestResult]
    summary: BatchSummary


@app.post("/api/speed-test/batch", response_model=BatchSpeedTestResponse)
async def batch_speed_test(req: BatchSpeedTestRequest):
    import asyncio
    import uuid
    from datetime import datetime, timezone

    all_tasks = []
    for test in req.tests:
        for _ in range(req.iterations):
            all_tasks.append(
                run_speed_test(
                    base_url=test.base_url,
                    api_key=test.api_key,
                    model=test.model,
                    prompt=req.prompt,
                    max_tokens=req.max_tokens,
                    temperature=req.temperature,
                    stream=req.stream,
                )
            )

    semaphore = asyncio.Semaphore(req.concurrency)

    async def run_with_semaphore(task):
        async with semaphore:
            return await task

    results = await asyncio.gather(*[run_with_semaphore(t) for t in all_tasks], return_exceptions=True)
    now_iso = datetime.now(timezone.utc).isoformat()
    results = [r if not isinstance(r, Exception) else {
        "id": str(uuid.uuid4()),
        "base_url": "",
        "model": "error",\n        "actual_model": "error",\n        "content_ttft_ms": None,\n        "reasoning_tokens": 0,\n        "content_tokens": 0,
        "prompt": req.prompt,
        "max_tokens": req.max_tokens,
        "temperature": req.temperature,
        "ttft_ms": None,
        "total_latency_ms": 0,
        "tokens_generated": 0,
        "tps": 0,
        "tpm": 0,
        "success": False,
        "error_message": str(r),
        "created_at": now_iso,
    } for r in results]

    # Save all results
    for r in results:
        await insert_speed_test(r)

    parsed = [SpeedTestResult(**r) for r in results]

    successful = [r for r in parsed if r.success]
    avg_tps = sum(r.tps for r in successful) / len(successful) if successful else 0
    avg_tpm = sum(r.tpm for r in successful) / len(successful) if successful else 0
    avg_lat = sum(r.total_latency_ms for r in successful) / len(successful) if successful else 0

    best = max(successful, key=lambda r: r.tps) if successful else None

    summary = BatchSummary(
        total_tests=len(parsed),
        successful=len(successful),
        failed=len(parsed) - len(successful),
        avg_tps=round(avg_tps, 2),
        avg_tpm=round(avg_tpm, 2),
        avg_latency_ms=round(avg_lat, 2),
        best_model=best.model if best else "",
        best_tps=best.tps if best else 0,
    )

    return BatchSpeedTestResponse(results=parsed, summary=summary)


@app.get("/api/history", response_model=list[SpeedTestHistory])
async def history(limit: int = Query(default=50, le=500), offset: int = Query(default=0)):
    tests = await get_all_tests(limit=limit, offset=offset)
    return [SpeedTestHistory(**t) for t in tests]


@app.get("/api/history/{test_id}", response_model=SpeedTestResult | None)
async def history_detail(test_id: str):
    test = await get_test_by_id(test_id)
    if test is None:
        return None
    return SpeedTestResult(**test)


@app.delete("/api/history/{test_id}")
async def remove_test(test_id: str):
    ok = await delete_test(test_id)
    if not ok:
        from fastapi import HTTPException
        raise HTTPException(404, "Test not found")
    return {"message": "Test deleted"}


@app.delete("/api/history")
async def clear_history():
    await delete_all_tests()
    return {"message": "History cleared"}


@app.get("/api/stats", response_model=StatsResponse)
async def stats():
    return await get_stats()


# ── Provider CRUD ──────────────────────────────────────────────


@app.get("/api/providers", response_model=ProviderListResponse)
async def get_providers():
    providers = await list_providers()
    return ProviderListResponse(providers=[ProviderResponse(**p) for p in providers])


@app.post("/api/providers", response_model=ProviderResponse, status_code=201)
async def add_provider(req: ProviderCreate):
    p = await create_provider(req.name, req.base_url, req.api_key, req.models if req.models else None)
    return ProviderResponse(**p)


@app.put("/api/providers/{provider_id}", response_model=ProviderResponse)
async def edit_provider(provider_id: str, req: ProviderUpdate):
    p = await update_provider(provider_id, req.name, req.base_url, req.api_key, models=req.models)
    if p is None:
        from fastapi import HTTPException
        raise HTTPException(404, "Provider not found")
    return ProviderResponse(**p)


@app.put("/api/providers/{provider_id}/models", response_model=ProviderResponse)
async def update_provider_models(provider_id: str, req: ProviderModelsUpdate):
    p = await save_provider_models(provider_id, req.models)
    if p is None:
        from fastapi import HTTPException
        raise HTTPException(404, "Provider not found")
    return ProviderResponse(**p)


@app.delete("/api/providers/{provider_id}")
async def remove_provider(provider_id: str):
    ok = await delete_provider(provider_id)
    if not ok:
        from fastapi import HTTPException
        raise HTTPException(404, "Provider not found")
    return {"message": "Provider deleted"}


# ── Connection ─────────────────────────────────────────────────
