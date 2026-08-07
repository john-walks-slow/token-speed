"""调度器核心逻辑单测：到期判定、next_run_at 计算、targets 解析、防重入、启动恢复。

数据库用 tmp_path 隔离，不碰真实 speed_tests.db。
"""
import asyncio
import uuid
from datetime import datetime, timezone, timedelta

import pytest

from backend import database
from backend.database import (
    _next_run_iso,
    create_provider,
    create_schedule,
    get_due_schedules,
    get_schedule,
    list_schedules,
    set_schedule_enabled,
    advance_schedule_next_run,
    mark_schedule_stale_running,
)
from backend.scheduler import SpeedTestScheduler


@pytest.fixture
def db(tmp_path):
    """指向临时库，测试间重置线程本地连接。"""
    database.DB_PATH = str(tmp_path / "test.db")
    database._local.conn = None
    yield
    conn = database._local.conn
    if conn is not None:
        conn.close()
        database._local.conn = None


def _force_due(schedule_id: str) -> None:
    past = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()
    database._run(
        "UPDATE schedules SET next_run_at=? WHERE id=?", (past, schedule_id)
    )


def _make_provider(name: str = "test-provider"):
    return asyncio.run(
        create_provider(name, "https://example.com", "sk-test", ["m1", "m2"])
    )


def _make_schedule(interval: int = 10, targets=None, **kw):
    p = _make_provider()
    if targets is None:
        targets = [{"provider_id": p["id"], "models": ["m1", "m2"]}]
    return asyncio.run(
        create_schedule(
            name="s", interval_minutes=interval, targets=targets,
            prompt="hi", max_tokens=10, temperature=0.7,
            stream=True, concurrency=1, iterations=1, **kw,
        )
    )


# ── next_run_at 计算 ───────────────────────────────────────────


def test_next_run_iso_adds_interval():
    now = "2026-08-07T12:00:00+00:00"
    assert _next_run_iso(now, 30) == "2026-08-07T12:30:00+00:00"


def test_next_run_iso_handles_naive_input():
    now = "2026-08-07T12:00:00"
    assert _next_run_iso(now, 5) == "2026-08-07T12:05:00+00:00"


# ── 创建 / 到期判定 ────────────────────────────────────────────


def test_create_schedule_sets_future_next_run(db):
    s = _make_schedule()
    assert s["enabled"] == 1
    assert s["targets"][0]["provider_id"]
    # 新建任务的 next_run_at 在将来（不会立即到期）
    assert datetime.fromisoformat(s["next_run_at"]) > datetime.now(timezone.utc)
    assert len(asyncio.run(list_schedules()))


def test_get_due_schedules_only_returns_expired(db):
    s = _make_schedule()
    # 新建任务未到期
    assert asyncio.run(get_due_schedules()) == []
    # 强制过期后到期
    _force_due(s["id"])
    due = asyncio.run(get_due_schedules())
    assert [d["id"] for d in due] == [s["id"]]


def test_disabled_schedule_not_due(db):
    s = _make_schedule()
    _force_due(s["id"])
    asyncio.run(set_schedule_enabled(s["id"], False))
    assert asyncio.run(get_due_schedules()) == []


def test_advance_schedule_next_run_skips_disabled(db):
    s = _make_schedule()
    asyncio.run(set_schedule_enabled(s["id"], False))
    asyncio.run(advance_schedule_next_run(s["id"], 10))
    # 暂停中的任务不推进 next_run_at
    assert asyncio.run(get_schedule(s["id"]))["next_run_at"] is None


# ── 执行流程（targets 解析 + 状态推进）─────────────────────────


def test_run_schedule_success_updates_status_and_advances(db, monkeypatch):
    s = _make_schedule()
    captured = {}

    async def fake_execute(tests, prompt, max_tokens, temperature, stream,
                           concurrency, iterations, schedule_id=None,
                           disable_reasoning=False, max_rpm=-1):
        captured["tests"] = tests
        captured["schedule_id"] = schedule_id
        captured["prompt"] = prompt
        captured["disable_reasoning"] = disable_reasoning
        captured["max_rpm"] = max_rpm
        return [{"success": True}, {"success": True}]

    monkeypatch.setattr("backend.scheduler.execute_batch_tests", fake_execute)

    async def run():
        await SpeedTestScheduler()._run_schedule(s["id"], advance_next=True)

    asyncio.run(run())

    # targets 解析：provider 实时取 base_url/api_key，模型展开
    assert len(captured["tests"]) == 2
    assert all(t["base_url"] == "https://example.com" for t in captured["tests"])
    assert all(t["api_key"] == "sk-test" for t in captured["tests"])
    assert all(t["provider_id"] for t in captured["tests"])
    assert all(t["provider_name"] == "test-provider" for t in captured["tests"])
    assert captured["schedule_id"] == s["id"]
    assert captured["prompt"] == "hi"
    # 新参数默认透传
    assert captured["disable_reasoning"] is False
    assert captured["max_rpm"] == -1

    updated = asyncio.run(get_schedule(s["id"]))
    assert updated["last_run_status"] == "success"
    # next_run_at 推进到将来（防忙循环）
    assert datetime.fromisoformat(updated["next_run_at"]) > datetime.now(timezone.utc)


def test_run_schedule_partial_status(db, monkeypatch):
    s = _make_schedule()

    async def fake_execute(*args, **kw):
        return [{"success": True}, {"success": False}]

    monkeypatch.setattr("backend.scheduler.execute_batch_tests", fake_execute)
    asyncio.run(SpeedTestScheduler()._run_schedule(s["id"], advance_next=True))
    assert asyncio.run(get_schedule(s["id"]))["last_run_status"] == "partial"


def test_run_schedule_skips_deleted_provider(db, monkeypatch):
    # 先建 provider 再删除 → target 全部失效 → failed
    s = _make_schedule()
    asyncio.run(database.delete_provider(s["targets"][0]["provider_id"]))
    called = {"n": 0}

    async def fake_execute(*args, **kw):
        called["n"] += 1
        return []

    monkeypatch.setattr("backend.scheduler.execute_batch_tests", fake_execute)
    asyncio.run(SpeedTestScheduler()._run_schedule(s["id"], advance_next=True))
    assert called["n"] == 0
    assert asyncio.run(get_schedule(s["id"]))["last_run_status"] == "failed"


# ── 防重入 ─────────────────────────────────────────────────────


def test_poll_does_not_double_dispatch(db, monkeypatch):
    s = _make_schedule()
    _force_due(s["id"])
    scheduler = SpeedTestScheduler()
    dispatched = []

    async def fake_run_schedule(self, schedule_id, advance_next=True):
        dispatched.append(schedule_id)

    monkeypatch.setattr(SpeedTestScheduler, "_run_schedule", fake_run_schedule)

    async def scenario():
        await scheduler._check_due()
        assert s["id"] in scheduler._running_ids
        await scheduler._check_due()  # 运行中，不重复派发

    asyncio.run(scenario())
    assert len(dispatched) == 1


# ── 启动恢复 ───────────────────────────────────────────────────


def test_start_resets_stale_running(db, monkeypatch):
    s = _make_schedule()
    asyncio.run(database.update_schedule_run_status(s["id"], "running"))
    scheduler = SpeedTestScheduler()
    monkeypatch.setattr(SpeedTestScheduler, "_poll", lambda self: asyncio.sleep(0))

    async def run():
        await scheduler.start()
        await scheduler.stop()

    asyncio.run(run())
    assert asyncio.run(get_schedule(s["id"]))["last_run_status"] == "failed"
