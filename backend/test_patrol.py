"""patrol_config / patrol_runner 单元测试。"""

import json
import os
import tempfile

import pytest

from .patrol_config import PatrolConfig, PatrolTarget, load_patrol_config


def test_load_patrol_config_example():
    """example 配置能正确加载，字段一一对应。"""
    cfg = load_patrol_config("config/patrol.json.example")
    assert len(cfg.targets) == 4
    assert cfg.targets[0].provider_name == "Groq"
    assert cfg.targets[0].api_key_env == "GROQ_API_KEY"
    assert cfg.targets[0].protocol == "openai"
    assert "openai/gpt-oss-20b" in cfg.targets[0].models
    # NVIDIA NIM target
    assert cfg.targets[1].provider_name == "NVIDIA NIM"
    assert cfg.targets[1].base_url == "https://integrate.api.nvidia.com/v1"
    # Google Gemini target
    assert cfg.targets[2].provider_name == "Google Gemini"
    assert cfg.targets[2].base_url == "https://generativelanguage.googleapis.com/v1beta/openai/"
    # SambaNova target
    assert cfg.targets[3].provider_name == "OpenCode Zen"
    assert "big-pickle" in cfg.targets[3].models
    assert cfg.stream is True
    assert cfg.max_tokens == 256
    assert cfg.temperature is None


def test_to_tests_expands_models(monkeypatch):
    """每个 model 展开为一条 test，api_key 从 env 解析。"""
    monkeypatch.setenv("FAKE_KEY", "sk-123")
    cfg = PatrolConfig(
        targets=[
            PatrolTarget(
                provider_name="P1", base_url="https://api.p1.com/v1",
                api_key_env="FAKE_KEY", protocol="openai",
                models=["m1", "m2"],
            )
        ]
    )
    tests = cfg.to_tests()
    assert len(tests) == 2
    assert tests[0]["model"] == "m1"
    assert tests[0]["api_key"] == "sk-123"
    assert tests[0]["provider_name"] == "P1"
    assert tests[0]["protocol"] == "openai"


def test_resolve_api_key_missing_returns_empty(monkeypatch):
    """环境变量缺失时返回空串（core 层会用空串请求，失败兜底）。"""
    monkeypatch.delenv("NO_SUCH_KEY", raising=False)
    t = PatrolTarget(provider_name="P", base_url="x", api_key_env="NO_SUCH_KEY")
    assert t.resolve_api_key() == ""


def test_patrol_runner_writes_jsonl(monkeypatch, tmp_path):
    """patrol_runner 用 mock execute_batch_tests 验证 JSONL 产出。"""
    import asyncio

    async def fake_execute(tests, prompt, max_tokens, temperature, stream,
                           concurrency, iterations, max_rpm=-1,
                           on_progress=None, sink=None):
        results = [{
            "id": "r1", "base_url": tests[0]["base_url"], "model": tests[0]["model"],
            "actual_model": tests[0]["model"], "provider_id": "", "provider_name": tests[0]["provider_name"],
            "response_content": "hi", "prompt": prompt,
            "max_tokens": max_tokens, "temperature": temperature,
            "ttft_ms": 100.0, "content_ttft_ms": 110.0, "total_latency_ms": 500.0,
            "tokens_generated": 10, "reasoning_tokens": 0, "content_tokens": 10,
            "input_tokens": 5, "thinking_ms": None, "tps": 20.0,
            "success": True, "error_message": None,
            "created_at": "2026-09-20T10:00:00+00:00",
        }]
        if sink:
            for r in results:
                await sink(r)
        return results

    monkeypatch.setattr("backend.patrol_runner.execute_batch_tests", fake_execute)

    cfg = {
        "prompt": "hi", "max_tokens": 100, "temperature": None,
        "stream": True, "concurrency": 1, "iterations": 1, "max_rpm": -1,
        "targets": [{
            "provider_name": "TestP", "base_url": "https://api.test.com/v1",
            "api_key_env": "TEST_KEY", "protocol": "openai", "models": ["m1"]
        }]
    }
    cfg_path = tmp_path / "patrol.json"
    cfg_path.write_text(json.dumps(cfg))
    monkeypatch.setenv("TEST_KEY", "sk-fake")

    data_dir = tmp_path / "data"
    from .patrol_runner import run_patrol
    out = asyncio.run(run_patrol(str(cfg_path), str(data_dir)))

    assert out.endswith(".jsonl")
    with open(out) as f:
        line = f.readline()
        data = json.loads(line)
    assert data["status"] == "success"
    assert data["total"] == 1
    assert data["results"][0]["tps"] == 20.0
    # 结果不含 api_key（脱敏验证）
    assert "api_key" not in data["results"][0]
