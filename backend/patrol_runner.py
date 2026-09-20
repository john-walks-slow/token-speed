"""巡检 runner：GH Actions 定时巡检入口（PATROL adapter）。

`python -m backend.patrol_runner` —— 不依赖 FastAPI 事件循环，
读 config/patrol.json → 组装 tests → execute_batch_tests(sink=json_sink)
→ 写 JSON 到 website/data/。

数据落地由 json_sink 注入（逐条收集，结束后一次性写文件）。core 层
（speed_test.py）不感知数据去向，与本地 App 共用同一测速内核。
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import uuid
from datetime import datetime, timezone

import httpx

from .patrol_config import load_patrol_config
from .speed_test import execute_batch_tests

# 巡检结果目录：放 website/data/ 下，随 Pages 一起发布
DEFAULT_DATA_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "website", "data",
)


async def discover_models(base_url: str, api_key: str, timeout: float, discover_url: str = "") -> list[str]:
    """从发现端点拉上游全量模型 id；失败返回空列表（退回显式 models）。

    兼容两种响应形状：OpenAI `{data: [{id}]}` 与 Cloudflare `{result: [{id: uuid, name}]}`。
    CF 的 id 是内部 UUID，模型名在 name 字段，故 name 优先。
    """
    url = (discover_url or base_url.rstrip("/") + "/models").rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=timeout, headers={"Authorization": f"Bearer {api_key}"}) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            body = resp.json()
        items = body.get("data") or body.get("result") or []
        return [m.get("name") or m.get("id") for m in items if m.get("name") or m.get("id")]
    except Exception as e:
        print(f"patrol: discover {base_url} failed: {e}", file=sys.stderr)
        return []


async def run_patrol(config_path: str, data_dir: str = DEFAULT_DATA_DIR) -> str:
    """执行一次巡检，结果写入 data_dir 下的按天 JSONL 文件。

    返回写入的文件路径。
    """
    cfg = load_patrol_config(config_path)

    # discover=true 的 target 先拉上游全量模型列表（与显式 models 并集后过过滤规则）
    timeout = cfg.timeout or 120.0
    discovered: dict[str, list[str]] = {}
    for t in cfg.targets:
        if t.discover:
            discovered[t.provider_name] = await discover_models(t.base_url, t.resolve_api_key(), timeout, t.discover_url)
            if discovered[t.provider_name]:
                print(f"patrol: discover {t.provider_name}: {len(discovered[t.provider_name])} models", file=sys.stderr)

    tests = cfg.to_tests(discovered)

    if not tests:
        print("patrol: no targets configured, skipping", file=sys.stderr)
        return ""

    run_id = str(uuid.uuid4())
    run_started = datetime.now(timezone.utc).isoformat()
    collected: list[dict] = []

    async def json_sink(result: dict) -> None:
        collected.append(result)

    results = await execute_batch_tests(
        tests,
        prompt=cfg.prompt,
        max_tokens=cfg.max_tokens,
        temperature=cfg.temperature,
        stream=cfg.stream,
        concurrency=cfg.concurrency,
        iterations=cfg.iterations,
        max_rpm=cfg.max_rpm,
        timeout=cfg.timeout,
        sink=json_sink,
    )

    run_finished = datetime.now(timezone.utc).isoformat()
    ok = sum(1 for r in results if r.get("success"))
    status = "success" if ok == len(results) else ("partial" if ok > 0 else "failed")

    # 按天分文件：website/data/YYYY-MM-DD.jsonl
    # 每行一个 run 的完整结果数组，便于静态看板按天加载
    os.makedirs(data_dir, exist_ok=True)
    day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    out_path = os.path.join(data_dir, f"{day}.jsonl")

    run_record = {
        "run_id": run_id,
        "started_at": run_started,
        "finished_at": run_finished,
        "status": status,
        "total": len(results),
        "success": ok,
        "failed": len(results) - ok,
        "results": results,
    }

    with open(out_path, "a", encoding="utf-8") as f:
        f.write(json.dumps(run_record, ensure_ascii=False) + "\n")

    print(f"patrol: {ok}/{len(results)} success → {out_path}", file=sys.stderr)
    return out_path


def main() -> None:
    config_path = os.environ.get("PATROL_CONFIG", "config/patrol.json")
    data_dir = os.environ.get("PATROL_DATA_DIR", DEFAULT_DATA_DIR)
    asyncio.run(run_patrol(config_path, data_dir))


if __name__ == "__main__":
    main()
