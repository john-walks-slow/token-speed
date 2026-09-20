"""测速指标口径单测：reasoning token 读取兼容、usage 口径统一、batch summary median 聚合。"""
import sqlite3

import pytest

from backend.speed_test import (
    _extract_reasoning_tokens,
    _reconcile_token_counts,
    _compute_itl,
    run_speed_test,
)
from backend.database import _backfill_tps
from backend.main import compute_summary, _median
from backend.models import SpeedTestResult


def _result(model: str, tps: float | None, latency_ms: float, base_url: str = "https://a") -> SpeedTestResult:
    return SpeedTestResult(
        id="x", base_url=base_url, model=model, actual_model=model,
        prompt="", max_tokens=256, temperature=0.7,
        ttft_ms=None, content_ttft_ms=None, total_latency_ms=latency_ms,
        tokens_generated=10, reasoning_tokens=0, content_tokens=10,
        thinking_ms=None, tps=tps, success=True, error_message=None,
    )


class TestExtractReasoningTokens:
    def test_openai_completion_details(self):
        usage = {"completion_tokens": 100, "completion_tokens_details": {"reasoning_tokens": 40}}
        assert _extract_reasoning_tokens(usage) == 40

    def test_openai_output_details_reasoning(self):
        usage = {"completion_tokens": 100, "output_tokens_details": {"reasoning_tokens": 30}}
        assert _extract_reasoning_tokens(usage) == 30

    def test_anthropic_thinking(self):
        usage = {"completion_tokens": 100, "output_tokens_details": {"thinking_tokens": 25}}
        assert _extract_reasoning_tokens(usage) == 25

    def test_top_level_reasoning(self):
        usage = {"completion_tokens": 100, "reasoning_tokens": 55}
        assert _extract_reasoning_tokens(usage) == 55

    def test_precedence_completion_over_output(self):
        usage = {
            "completion_tokens": 100,
            "completion_tokens_details": {"reasoning_tokens": 40},
            "output_tokens_details": {"reasoning_tokens": 30},
        }
        assert _extract_reasoning_tokens(usage) == 40

    def test_missing_returns_zero(self):
        assert _extract_reasoning_tokens({}) == 0
        assert _extract_reasoning_tokens(None) == 0
        assert _extract_reasoning_tokens({"completion_tokens": 10}) == 0


class TestReconcileTokenCounts:
    """两种 usage 口径统一：reasoning 是否计入 completion_tokens。"""

    def test_openai_style_reasoning_included(self):
        # OpenAI/DeepSeek：completion 含 reasoning → content = 94-40 = 54
        assert _reconcile_token_counts(94, 40) == (94, 40, 54)

    def test_gemini_style_reasoning_separate(self):
        # CLIProxyAPI 转发 Gemini：completion 仅正文、reasoning 独立
        assert _reconcile_token_counts(43, 931) == (974, 931, 43)

    def test_no_reasoning(self):
        assert _reconcile_token_counts(97, 0) == (97, 0, 97)

    def test_reasoning_equals_completion(self):
        # 纯思考无正文（OpenAI 口径：completion=reasoning, content=0）
        assert _reconcile_token_counts(50, 50) == (50, 50, 0)


class TestBackfillTps:
    """历史库 tps 口径回填：旧库 tps 需统一为 tokens_generated / 全程总耗时。"""

    @pytest.fixture
    def conn(self):
        c = sqlite3.connect(":memory:")
        c.row_factory = sqlite3.Row
        c.execute(
            """CREATE TABLE speed_tests (
                id TEXT PRIMARY KEY, model TEXT, tokens_generated INTEGER,
                total_latency_ms REAL, tps REAL, success INTEGER)"""
        )
        yield c
        c.close()

    def test_recompute_success_rows(self, conn):
        # success 行：tps 被重算为整体有效速度
        conn.execute(
            "INSERT INTO speed_tests VALUES ('a','m',100,20000,999,1)"
        )
        _backfill_tps(conn)
        row = conn.execute("SELECT tps FROM speed_tests WHERE id='a'").fetchone()
        assert row["tps"] == round(100 / 20, 2)  # 100 / (20000/1000) = 5

    def test_skip_failed_or_zero(self, conn):
        conn.execute("INSERT INTO speed_tests VALUES ('f','m',100,20000,999,0)")  # 失败
        conn.execute("INSERT INTO speed_tests VALUES ('z','m',0,20000,999,1)")    # 无 token
        _backfill_tps(conn)
        for rid in ("f", "z"):
            row = conn.execute("SELECT tps FROM speed_tests WHERE id=?", (rid,)).fetchone()
            assert row["tps"] == 999  # 未更新

    def test_skip_total_latency_zero(self, conn):
        conn.execute("INSERT INTO speed_tests VALUES ('l','m',100,0,999,1)")
        _backfill_tps(conn)
        row = conn.execute("SELECT tps FROM speed_tests WHERE id='l'").fetchone()
        assert row["tps"] == 999


class TestItl:
    """ITL 口径：(总耗时 - content_ttft) / content_tokens，仅流式可测。"""

    def test_formula(self):
        # 100 token 正文，首字 2s，总耗时 5s → 发射耗时 3s → ITL = 30ms/token
        assert round(_compute_itl(100, 2000.0, 5000.0), 2) == 30.0

    def test_non_stream_no_content_ttft(self):
        assert _compute_itl(100, None, 5000.0) is None

    def test_no_content_tokens(self):
        # 纯思考无正文（content=0）：无发射可言
        assert _compute_itl(0, 2000.0, 5000.0) is None

    def test_degenerate_latency(self):
        # 总耗时 <= content_ttft（时钟毛刺）：不可测，不产生负值
        assert _compute_itl(100, 5000.0, 5000.0) is None
        assert _compute_itl(100, 5001.0, 5000.0) is None

    def test_stream_result_carries_itl(self):
        # 走真实代码路径：伪 SSE 流，验证返回结构含 itl_ms 且与公式一致
        import asyncio

        class FakeResp:
            status_code = 200
            async def aread(self):
                return b""
            def raise_for_status(self):
                pass
            async def aiter_lines(self):
                yield 'data: {"choices":[{"delta":{"content":"Hi"}}]}'
                yield 'data: {"choices":[{"delta":{"content":" there"}}],"usage":{"completion_tokens":10,"prompt_tokens":5}}'
                yield "data: [DONE]"
            async def __aenter__(self):
                return self
            async def __aexit__(self, *a):
                return False

        class FakeClient:
            def __init__(self, *a, **kw):
                pass
            def stream(self, *a, **kw):
                return FakeResp()
            async def __aenter__(self):
                return self
            async def __aexit__(self, *a):
                return False

        import backend.speed_test as st

        async def go():
            orig = st.httpx.AsyncClient
            st.httpx.AsyncClient = FakeClient
            try:
                return await run_speed_test("http://x", model="m", stream=True)
            finally:
                st.httpx.AsyncClient = orig

        r = asyncio.run(go())
        # mock 流亚毫秒级完成，2 位小数圆整后重套公式误差被放大，
        # 故只断言代码路径确实产出正的 itl_ms（公式正确性由纯函数用例覆盖）
        assert r["itl_ms"] is not None and r["itl_ms"] > 0

    def test_non_stream_itl_is_none(self):
        import asyncio

        class FakeResp:
            status_code = 200
            async def aread(self):
                return b""
            def raise_for_status(self):
                pass
            def json(self):
                return {"model": "m", "choices": [{"message": {"content": "hi"}}],
                        "usage": {"completion_tokens": 5, "prompt_tokens": 2}}
            async def __aenter__(self):
                return self
            async def __aexit__(self, *a):
                return False

        class FakeClient:
            def __init__(self, *a, **kw):
                pass
            async def __aenter__(self):
                return self
            async def __aexit__(self, *a):
                return False
            async def post(self, *a, **kw):
                return FakeResp()

        import backend.speed_test as st

        async def go():
            orig = st.httpx.AsyncClient
            st.httpx.AsyncClient = FakeClient
            try:
                return await run_speed_test("http://x", model="m", stream=False)
            finally:
                st.httpx.AsyncClient = orig

        r = asyncio.run(go())
        assert r["itl_ms"] is None  # 非流式无 content_ttft，ITL 不可测
        assert r["tps"] is not None


class TestMedian:
    def test_odd(self):
        assert _median([3, 1, 2]) == 2

    def test_even(self):
        assert _median([4, 1, 3, 2]) == 2.5

    def test_empty(self):
        assert _median([]) == 0


class TestComputeSummary:
    def test_median_aggregation_per_pair(self):
        parsed = [
            _result("m1", 10, 100),
            _result("m1", 20, 100),
            _result("m1", 30, 100),
            _result("m2", 5, 200),
            _result("m2", 15, 200),
        ]
        s = compute_summary(parsed)
        # m1 median=20, m2 median=10；avg 取 (20+10)/2=15；best=m1
        assert s.avg_tps == 15
        assert s.best_model == "m1"
        assert s.best_tps == 20
        assert s.successful == 5

    def test_none_tps_excluded_from_speed(self):
        parsed = [
            _result("m1", None, 100),
            _result("m1", 20, 100),
        ]
        s = compute_summary(parsed)
        # None 不计入速度汇总；m1 只有 1 个有效样本，median=20
        assert s.avg_tps == 20
        assert s.successful == 2

    def test_failed_excluded(self):
        failed = _result("m1", 99, 999)
        failed.success = False
        parsed = [_result("m1", 10, 100), failed]
        s = compute_summary(parsed)
        assert s.avg_tps == 10
        assert s.successful == 1
        assert s.failed == 1

    def test_same_model_different_provider_kept_separate(self):
        parsed = [
            _result("gpt-4o", 50, 100, base_url="https://a"),
            _result("gpt-4o", 10, 100, base_url="https://b"),
        ]
        s = compute_summary(parsed)
        # 两个 provider 各自成组，median 各取自身 → avg=(50+10)/2=30；best 取 50 的组
        assert s.avg_tps == 30
        assert s.best_model == "gpt-4o"
        assert s.best_tps == 50


def test_client_kwargs_default_and_injection():
    """不传 client_kwargs 走默认（trust_env），传入时完整生效——adapter 注入契约的回归测试。"""
    import asyncio

    captured = {}

    class FakeClient:
        def __init__(self, *a, **kw):
            captured.update(kw)

        async def post(self, *a, **kw):
            class FakeResp:
                status_code = 200
                async def aread(self):
                    return b""
                def raise_for_status(self):
                    pass
                def json(self):
                    return {"model": "m", "choices": [{"message": {"content": "hi"}}],
                            "usage": {"completion_tokens": 5, "prompt_tokens": 2}}
            return FakeResp()

        async def __aenter__(self):
            return self
        async def __aexit__(self, *a):
            return False

    async def go(**kw):
        captured.clear()
        import backend.speed_test as st
        orig = st.httpx.AsyncClient
        st.httpx.AsyncClient = FakeClient
        try:
            return await run_speed_test("http://x", model="m", **kw)
        finally:
            st.httpx.AsyncClient = orig

    r = asyncio.run(go())
    assert r["success"] is True
    assert captured["trust_env"] is True

    r = asyncio.run(go(client_kwargs={"proxy": "http://127.0.0.1:7890", "verify": False, "trust_env": False}))
    assert r["success"] is True
    assert captured["proxy"] == "http://127.0.0.1:7890"
    assert captured["verify"] is False
    assert captured["trust_env"] is False
