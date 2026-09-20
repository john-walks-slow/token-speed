"""巡检配置：静态文件 + 环境变量密钥注入的数据结构。

core 层契约——本地 App（从 SQLite 组装）与 GH 巡检（从 patrol.json 加载）
共用同一结构，加载方式各自由 adapter 决定。

密钥不落盘：配置只存环境变量名（api_key_env），由调用方从 os.environ 解析成
明文传入 core 的 run_speed_test，巡检结果 JSON 不含 api_key。
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field


@dataclass
class PatrolTarget:
    provider_name: str
    base_url: str
    api_key_env: str  # 环境变量名，不存明文
    protocol: str = "openai"
    models: list[str] = field(default_factory=list)

    def resolve_api_key(self) -> str:
        """从环境变量读取密钥；缺失返回空串（core 层会用空串发起请求，失败兜底）。"""
        return os.environ.get(self.api_key_env, "")


@dataclass
class PatrolConfig:
    prompt: str = "Hello, tell me a short story in 3 sentences."
    max_tokens: int | None = None
    temperature: float | None = None
    stream: bool = True
    concurrency: int = 1
    iterations: int = 1
    max_rpm: int = -1
    targets: list[PatrolTarget] = field(default_factory=list)

    def to_tests(self) -> list[dict]:
        """展开为 execute_batch_tests 所需的 tests 列表（每 model 一条）。

        api_key 在此解析为明文，传入 core；结果 dict 不含 api_key，不落盘。
        """
        tests: list[dict] = []
        for t in self.targets:
            api_key = t.resolve_api_key()
            for m in t.models:
                tests.append({
                    "model": m,
                    "base_url": t.base_url,
                    "api_key": api_key,
                    "provider_id": "",  # 巡检无 SQLite provider 实体
                    "provider_name": t.provider_name,
                    "protocol": t.protocol,
                })
        return tests


def load_patrol_config(path: str) -> PatrolConfig:
    """从 JSON 文件加载巡检配置（GH adapter 用）。

    JSON 结构与 PatrolConfig/ParamTarget 字段一一对应，snake_case。
    """
    import json

    with open(path, encoding="utf-8") as f:
        raw = json.load(f)

    targets = [
        PatrolTarget(
            provider_name=t["provider_name"],
            base_url=t["base_url"],
            api_key_env=t["api_key_env"],
            protocol=t.get("protocol", "openai"),
            models=t.get("models", []),
        )
        for t in raw.get("targets", [])
    ]
    return PatrolConfig(
        prompt=raw.get("prompt", PatrolConfig().prompt),
        max_tokens=raw.get("max_tokens"),
        temperature=raw.get("temperature"),
        stream=raw.get("stream", True),
        concurrency=raw.get("concurrency", 1),
        iterations=raw.get("iterations", 1),
        max_rpm=raw.get("max_rpm", -1),
        targets=targets,
    )
