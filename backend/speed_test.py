import asyncio
import time
import uuid
from datetime import datetime, timezone

import httpx

from .database import insert_speed_test
from .rate_limit import limiter


async def list_models(base_url: str, api_key: str = "") -> tuple[bool, list[dict] | str]:
    """Fetch available models from an OpenAI-compatible API endpoint.

    base_url 需自带路径（含 /v1 等），不再自动拼接。
    """
    url = f"{base_url.rstrip('/')}/models"
    headers = {}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(url, headers=headers)
            resp.raise_for_status()
            data = resp.json()
            models = [
                {"id": m["id"], "owned_by": m.get("owned_by", "unknown")}
                for m in data.get("data", [])
            ]
            return True, models
    except Exception as e:
        return False, str(e)


async def run_speed_test(
    base_url: str,
    api_key: str = "",
    model: str = "",
    prompt: str = "Hello, tell me a short story in 3 sentences.",
    max_tokens: int = 256,
    temperature: float = 0.7,
    stream: bool = False,
    disable_reasoning: bool = False,
    provider_id: str = "",
    provider_name: str = "",
) -> dict:
    """Run a single speed test against an OpenAI/Anthropic-compatible API.

    base_url 需自带路径（含 /v1 等），不再自动拼接。
    disable_reasoning 为 True 时尽量关闭模型的思考/推理（best-effort），
    仅对支持该参数的服务商生效。
    """
    url = f"{base_url.rstrip('/')}/chat/completions"
    headers = {
        "Content-Type": "application/json",
    }
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    payload = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": max_tokens,
        "temperature": temperature,
        "stream": stream,
    }
    if disable_reasoning:
        payload["thinking"] = {"type": "disabled"}

    test_id = str(uuid.uuid4())
    created_at = datetime.now(timezone.utc).isoformat()
    ttft_ms = None
    content_ttft_ms = None
    total_latency_ms = 0
    tokens_generated = 0
    reasoning_tokens = 0
    content_tokens = 0
    actual_model = model

    try:
        start = time.perf_counter()

        if stream:
            reasoning_chunk_count = 0
            content_chunk_count = 0
            first_token = True
            first_content_token = True
            content_parts: list[str] = []

            async with httpx.AsyncClient(timeout=120.0) as client:
                async with client.stream("POST", url, json=payload, headers=headers) as resp:
                    resp.raise_for_status()
                    async for line in resp.aiter_lines():
                        if not line.strip() or line.startswith(":"):
                            continue
                        if line.startswith("data: "):
                            data_str = line[6:]
                            if data_str.strip() == "[DONE]":
                                break
                            try:
                                import json
                                chunk = json.loads(data_str)
                                m = chunk.get("model")
                                if m:
                                    actual_model = m
                                usage = chunk.get("usage")
                                choices = chunk.get("choices", [])
                                if choices:
                                    delta = choices[0].get("delta", {})
                                    rc = delta.get("reasoning_content")
                                    ct = delta.get("content")
                                    if rc:
                                        if first_token:
                                            ttft_ms = (time.perf_counter() - start) * 1000
                                            first_token = False
                                        reasoning_chunk_count += 1
                                    if ct:
                                        if first_token:
                                            ttft_ms = (time.perf_counter() - start) * 1000
                                            first_token = False
                                        if first_content_token:
                                            content_ttft_ms = (time.perf_counter() - start) * 1000
                                            first_content_token = False
                                        content_chunk_count += 1
                                        content_parts.append(ct)
                                if usage:
                                    tokens_generated = usage.get("completion_tokens", 0) or 0
                                    details = usage.get("completion_tokens_details", {})
                                    reasoning_tokens = details.get("reasoning_tokens", 0) or 0
                                    content_tokens = tokens_generated - reasoning_tokens
                            except json.JSONDecodeError:
                                continue

            # Fallback to chunk counts if usage not provided
            if tokens_generated == 0:
                reasoning_tokens = reasoning_chunk_count
                content_tokens = content_chunk_count
                tokens_generated = reasoning_chunk_count + content_chunk_count

            response_content = "".join(content_parts) or None
            total_latency_ms = (time.perf_counter() - start) * 1000
        else:
            async with httpx.AsyncClient(timeout=120.0) as client:
                resp = await client.post(url, json=payload, headers=headers)
                resp.raise_for_status()
                data = resp.json()

            total_latency_ms = (time.perf_counter() - start) * 1000
            usage = data.get("usage", {})
            tokens_generated = usage.get("completion_tokens", 0) or 0
            details = usage.get("completion_tokens_details", {})
            reasoning_tokens = details.get("reasoning_tokens", 0) or 0
            content_tokens = tokens_generated - reasoning_tokens
            actual_model = data.get("model", model)
            response_content = data.get("choices", [{}])[0].get("message", {}).get("content") or None
            # Non-streaming: no meaningful TTFT
            ttft_ms = None
            content_ttft_ms = None

        tps = (tokens_generated / (total_latency_ms / 1000)) if total_latency_ms > 0 and tokens_generated > 0 else 0

        return {
            "id": test_id,
            "base_url": base_url,
            "model": model,
            "actual_model": actual_model,
            "provider_id": provider_id,
            "provider_name": provider_name,
            "response_content": response_content,
            "prompt": prompt,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "ttft_ms": round(ttft_ms, 2) if ttft_ms is not None else None,
            "content_ttft_ms": round(content_ttft_ms, 2) if content_ttft_ms is not None else None,
            "total_latency_ms": round(total_latency_ms, 2),
            "tokens_generated": tokens_generated,
            "reasoning_tokens": reasoning_tokens,
            "content_tokens": content_tokens,
            "tps": round(tps, 2),
            "success": True,
            "error_message": None,
            "created_at": created_at,
        }
    except Exception as e:
        total_latency_ms = (time.perf_counter() - start) * 1000 if 'start' in dir() else 0
        return {
            "id": test_id,
            "base_url": base_url,
            "model": model,
            "actual_model": model,
            "provider_id": provider_id,
            "provider_name": provider_name,
            "response_content": None,
            "prompt": prompt,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "ttft_ms": None,
            "content_ttft_ms": None,
            "total_latency_ms": round(total_latency_ms, 2),
            "tokens_generated": 0,
            "reasoning_tokens": 0,
            "content_tokens": 0,
            "tps": 0,
            "success": False,
            "error_message": str(e),
            "created_at": created_at,
        }


async def execute_batch_tests(
    tests: list[dict],
    prompt: str,
    max_tokens: int,
    temperature: float,
    stream: bool,
    concurrency: int,
    iterations: int,
    schedule_id: str | None = None,
    disable_reasoning: bool = False,
    max_rpm: int = -1,
) -> list[dict]:
    """批量执行测速并入库。batch 端点与定时调度器共用。

    并发按 provider(base_url+api_key) 分桶：每个 provider 独占一个 Semaphore(concurrency)，
    不同 provider 互不挤占。桶内按模型 round-robin 交错展开（每轮迭代依次取各 model），
    使同 provider 各模型在相同并发密度下被测。返回每个测试的结果 dict（异常以失败结果兜底）。
    schedule_id 非空时标记到历史。
    """
    # 按 provider 分桶，桶内保留原始 model 顺序
    buckets: dict[tuple[str, str], list[dict]] = {}
    for t in tests:
        key = (t["base_url"], t.get("api_key", ""))
        buckets.setdefault(key, []).append(t)

    # 桶内按模型 round-robin 展开
    all_items: list[dict] = []
    for items in buckets.values():
        for _ in range(iterations):
            all_items.extend(items)

    semaphores = {key: asyncio.Semaphore(concurrency) for key in buckets}

    async def run_one(item: dict) -> dict:
        key = (item["base_url"], item.get("api_key", ""))
        await limiter.acquire(key, max_rpm)
        sem = semaphores[key]
        async with sem:
            try:
                return await run_speed_test(
                    base_url=item["base_url"],
                    api_key=item.get("api_key", ""),
                    model=item["model"],
                    prompt=prompt,
                    max_tokens=max_tokens,
                    temperature=temperature,
                    stream=stream,
                    disable_reasoning=disable_reasoning,
                    provider_id=item.get("provider_id", ""),
                    provider_name=item.get("provider_name", ""),
                )
            except Exception as e:
                return _batch_error_result(e, item, prompt, max_tokens, temperature)

    results = await asyncio.gather(*[run_one(it) for it in all_items], return_exceptions=True)
    results = [r if not isinstance(r, Exception) else _batch_error_result(r, it, prompt, max_tokens, temperature) for r, it in zip(results, all_items)]

    for r in results:
        await insert_speed_test(r, schedule_id)

    return results


def _batch_error_result(exc: BaseException, item: dict, prompt: str, max_tokens: int, temperature: float) -> dict:
    """构造批量测速的失败兜底结果。"""
    return {
        "id": str(uuid.uuid4()),
        "base_url": item.get("base_url", ""),
        "model": item.get("model", "error"),
        "actual_model": "error",
        "provider_id": item.get("provider_id", ""),
        "provider_name": item.get("provider_name", ""),
        "response_content": None,
        "content_ttft_ms": None,
        "reasoning_tokens": 0,
        "content_tokens": 0,
        "prompt": prompt,
        "max_tokens": max_tokens,
        "temperature": temperature,
        "ttft_ms": None,
        "total_latency_ms": 0,
        "tokens_generated": 0,
        "tps": 0,
        "success": False,
        "error_message": str(exc),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }

