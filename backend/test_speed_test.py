"""测速指标口径单测：reasoning token 读取兼容、usage 口径统一、batch summary median 聚合。"""
import pytest

from backend.speed_test import _extract_reasoning_tokens, _reconcile_token_counts
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
