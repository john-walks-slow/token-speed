import time
import uuid
from datetime import datetime, timezone

import httpx


async def list_models(base_url: str, api_key: str = "") -> tuple[bool, list[dict] | str]:
    """Fetch available models from an OpenAI-compatible API endpoint."""
    url = f"{base_url.rstrip('/')}/v1/models"
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
    max_tokens: int = 128,
    temperature: float = 0.7,
    stream: bool = False,
) -> dict:
    """Run a single speed test against an OpenAI-compatible API."""
    url = f"{base_url.rstrip('/')}/v1/chat/completions"
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
            # Non-streaming: no meaningful TTFT
            ttft_ms = None
            content_ttft_ms = None

        tps = (tokens_generated / (total_latency_ms / 1000)) if total_latency_ms > 0 and tokens_generated > 0 else 0
        tpm = tps * 60

        return {
            "id": test_id,
            "base_url": base_url,
            "model": model,
            "actual_model": actual_model,
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
            "tpm": round(tpm, 2),
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
            "tpm": 0,
            "success": False,
            "error_message": str(e),
            "created_at": created_at,
        }

