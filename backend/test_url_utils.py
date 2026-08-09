"""base_url 规范化逻辑单测。"""

from backend.url_utils import normalize_base_url


def test_omit_scheme_adds_https():
    assert normalize_base_url("xxx.com/v1") == "https://xxx.com/v1"
    assert normalize_base_url("xxx.com") == "https://xxx.com"


def test_full_url_preserved():
    assert normalize_base_url("https://h.com/api") == "https://h.com/api"
    assert normalize_base_url("http://127.0.0.1:8000/v1") == "http://127.0.0.1:8000/v1"


def test_trailing_slash_stripped():
    assert normalize_base_url("xxx.com/v1/") == "https://xxx.com/v1"


def test_empty_returns_https_only():
    assert normalize_base_url("") == "https://"
