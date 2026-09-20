import sqlite3
import threading
import shutil
import os
import uuid
import json
from datetime import datetime, timezone

import sys

from .paths import is_frozen, db_path as _default_db_path


def _resolve_db_path() -> str:
    """frozen(exe) 用 %APPDATA% 数据目录，否则保持 backend/speed_tests.db。
    桌面首启时若 exe 旁的旧库存在且新位置无库，复制迁移以保留数据。
    """
    path = _default_db_path()
    if is_frozen():
        exe_dir = os.path.dirname(os.path.abspath(sys.executable))
        for old in (
            os.path.join(exe_dir, "speed_tests.db"),
            os.path.join(exe_dir, "backend", "speed_tests.db"),
        ):
            if os.path.isfile(old) and not os.path.isfile(path):
                os.makedirs(os.path.dirname(path), exist_ok=True)
                try:
                    shutil.copy2(old, path)
                except OSError:
                    pass
                break
    return path


DB_PATH = _resolve_db_path()

_local = threading.local()


def _get_conn():
    if not hasattr(_local, "conn") or _local.conn is None:
        _local.conn = sqlite3.connect(DB_PATH, check_same_thread=False)
        _local.conn.row_factory = sqlite3.Row
        _local.conn.execute("""CREATE TABLE IF NOT EXISTS speed_tests (
            id              TEXT PRIMARY KEY,
            base_url        TEXT NOT NULL,
            model           TEXT NOT NULL,
            prompt          TEXT,
            max_tokens      INTEGER,
            temperature     REAL,
            ttft_ms         REAL,
            total_latency_ms REAL,
            tokens_generated INTEGER,
            tps             REAL,
            success         INTEGER,
            error_message   TEXT,
            created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )""")
        _local.conn.execute("""CREATE TABLE IF NOT EXISTS providers (
            id          TEXT PRIMARY KEY,
            name        TEXT NOT NULL,
            base_url    TEXT NOT NULL,
            api_key     TEXT DEFAULT '',
            protocol    TEXT DEFAULT 'openai',
            models_json TEXT DEFAULT '[]',
            created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )""")
        _local.conn.execute("""CREATE TABLE IF NOT EXISTS settings (
            key   TEXT PRIMARY KEY,
            value TEXT
        )""")
        _local.conn.execute("""CREATE TABLE IF NOT EXISTS schedules (
            id               TEXT PRIMARY KEY,
            name             TEXT NOT NULL,
            enabled          INTEGER DEFAULT 1,
            interval_minutes INTEGER NOT NULL,
            prompt           TEXT,
            max_tokens       INTEGER DEFAULT 256,
            temperature      REAL DEFAULT 0.7,
            stream           INTEGER DEFAULT 1,
            concurrency      INTEGER DEFAULT 1,
            iterations       INTEGER DEFAULT 1,
            max_rpm          INTEGER DEFAULT -1,
            targets_json     TEXT DEFAULT '[]',
            created_at       TIMESTAMP,
            updated_at       TIMESTAMP,
            last_run_at      TIMESTAMP,
            next_run_at      TIMESTAMP,
            last_run_status  TEXT
        )""")
        # Migrations for schema additions
        for col_def in [
            "actual_model TEXT DEFAULT ''",
            "content_ttft_ms REAL",
            "reasoning_tokens INTEGER DEFAULT 0",
            "content_tokens INTEGER DEFAULT 0",
            "thinking_ms REAL",
            "itl_ms REAL",
            "input_tokens INTEGER",
            "schedule_id TEXT",
            "provider_id TEXT",
            "provider_name TEXT",
            "response_content TEXT",
        ]:
            col_name = col_def.split()[0]
            try:
                _local.conn.execute(f"ALTER TABLE speed_tests ADD COLUMN {col_def}")
            except sqlite3.OperationalError:
                pass  # column already exists
        try:
            _local.conn.execute("ALTER TABLE providers ADD COLUMN models_json TEXT DEFAULT '[]'")
        except sqlite3.OperationalError:
            pass  # column already exists
        try:
            _local.conn.execute("ALTER TABLE providers ADD COLUMN protocol TEXT DEFAULT 'openai'")
        except sqlite3.OperationalError:
            pass  # column already exists
        for col_def in [
            "max_rpm INTEGER DEFAULT -1",
            "run_total INTEGER DEFAULT 0",
            "run_done INTEGER DEFAULT 0",
            "run_success INTEGER DEFAULT 0",
        ]:
            col_name = col_def.split()[0]
            try:
                _local.conn.execute(f"ALTER TABLE schedules ADD COLUMN {col_def}")
            except sqlite3.OperationalError:
                pass  # column already exists
        # 历史库 tps 口径回填（一次性）：新口径 = tokens_generated / 全程总耗时。
        # 旧库多把 tps 算成“首个正文 token 之后的解码速率”，会漏掉 TTFT 内的思考耗时，
        # 与当前定义冲突；只在缺少内容时回填，保证与未来新数据口径一致。
        _backfill_tps(_local.conn)
        _local.conn.commit()
    return _local.conn


def _run(sql, params=None):
    conn = _get_conn()
    cur = conn.execute(sql, params or ())
    conn.commit()
    return cur


def _backfill_tps(conn) -> None:
    """历史 tps 口径回填：新口径 = tokens_generated / total_latency_ms。

    仅处理成功样本且 tokens_generated>0 且 total_latency_ms>0 的行，统一换算秒。
    需在 _get_conn 的列迁移之后、commit 之前执行，且只在缺少内容时（表为空则跳过）。
    """
    try:
        conn.execute(
            """UPDATE speed_tests
               SET tps = ROUND(tokens_generated / (total_latency_ms / 1000.0), 2)
               WHERE success = 1 AND tokens_generated > 0 AND total_latency_ms > 0"""
        )
    except sqlite3.OperationalError:
        pass  # speed_tests 表尚未创建（首启）时静默忽略


def _fetchall(sql, params=None):
    cur = _run(sql, params)
    return [dict(r) for r in cur.fetchall()]


def _fetchone(sql, params=None):
    cur = _run(sql, params)
    row = cur.fetchone()
    return dict(row) if row else None


def _median(values: list[float]) -> float:
    """P50。延迟/速度类指标在长尾下用 median 比 mean 稳定。"""
    if not values:
        return 0.0
    s = sorted(values)
    n = len(s)
    mid = n // 2
    if n % 2:
        return s[mid]
    return (s[mid - 1] + s[mid]) / 2


async def insert_speed_test(result: dict, schedule_id: str | None = None) -> None:
    _run(
        """INSERT INTO speed_tests
           (id, base_url, model, actual_model, prompt, max_tokens, temperature,
            ttft_ms, content_ttft_ms, total_latency_ms, tokens_generated,
            reasoning_tokens, content_tokens, thinking_ms, tps, itl_ms,
            success, error_message, created_at, schedule_id,
            provider_id, provider_name, response_content, input_tokens)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            result["id"],
            result["base_url"],
            result["model"],
            result.get("actual_model", ""),
            result["prompt"],
            result["max_tokens"],
            result["temperature"],
            result.get("ttft_ms"),
            result.get("content_ttft_ms"),
            result["total_latency_ms"],
            result["tokens_generated"],
            result.get("reasoning_tokens", 0),
            result.get("content_tokens", 0),
            result.get("thinking_ms"),
            result.get("tps"),
            result.get("itl_ms"),
            1 if result["success"] else 0,
            result.get("error_message"),
            result.get("created_at"),
            schedule_id,
            result.get("provider_id"),
            result.get("provider_name"),
            result.get("response_content"),
            result.get("input_tokens", 0),
        ),
    )


async def get_all_tests(limit: int = 50, offset: int = 0) -> list[dict]:
    return _fetchall(
        "SELECT * FROM speed_tests ORDER BY created_at DESC LIMIT ? OFFSET ?",
        (limit, offset),
    )


async def get_test_by_id(test_id: str) -> dict | None:
    return _fetchone("SELECT * FROM speed_tests WHERE id = ?", (test_id,))


async def delete_test(test_id: str) -> bool:
    existing = _fetchone("SELECT id FROM speed_tests WHERE id = ?", (test_id,))
    if not existing:
        return False
    _run("DELETE FROM speed_tests WHERE id = ?", (test_id,))
    return True


async def delete_all_tests() -> None:
    _run("DELETE FROM speed_tests")


async def get_stats() -> dict:
    rows = _fetchall("SELECT COUNT(*) as count FROM speed_tests")
    total = rows[0]["count"] if rows else 0

    if total == 0:
        return {
            "total_tests": 0,
            "success_rate": 0,
            "avg_tps": 0,
            "avg_latency_ms": 0,
            "avg_ttft_ms": None,
            "tests_by_model": [],
            "recent_tests": [],
        }

    stats = _fetchone(
        """SELECT
            CAST(SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) AS REAL) / COUNT(*) as success_rate,
            AVG(total_latency_ms) as avg_latency_ms,
            AVG(CASE WHEN ttft_ms IS NOT NULL THEN ttft_ms ELSE NULL END) as avg_ttft_ms
        FROM speed_tests"""
    )

    # 速度用 median(P50)（长尾分布下 mean 被慢样本拉偏），SQLite 无 median，取数后 Python 算
    tps_rows = _fetchall(
        "SELECT tps FROM speed_tests WHERE success = 1 AND tps IS NOT NULL"
    )
    tps_vals = [r["tps"] for r in tps_rows]
    median_tps = _median(tps_vals) if tps_vals else None

    # 按 model 分组的 median tps / median latency（成功样本）
    model_rows = _fetchall(
        """SELECT model, tps, total_latency_ms
        FROM speed_tests WHERE success = 1"""
    )
    by_model_group: dict[str, list[tuple[float | None, float]]] = {}
    for r in model_rows:
        by_model_group.setdefault(r["model"], []).append((r["tps"], r["total_latency_ms"]))
    by_model = []
    for m, vals in sorted(by_model_group.items(), key=lambda kv: -len(kv[1])):
        tps_vals = [v[0] for v in vals if v[0] is not None]
        by_model.append({
            "model": m,
            "count": len(vals),  # 成功样本数（含无速度样本）
            "avg_tps": round(_median(tps_vals), 2) if tps_vals else 0,
            "avg_latency": round(_median([v[1] for v in vals]), 2),
        })

    recent = _fetchall("SELECT * FROM speed_tests ORDER BY created_at DESC LIMIT 10")

    return {
        "total_tests": total,
        "success_rate": round(stats["success_rate"] * 100, 1) if stats["success_rate"] else 0,
        "avg_tps": round(median_tps, 2) if median_tps is not None else 0,
        "avg_latency_ms": round(stats["avg_latency_ms"], 2) if stats["avg_latency_ms"] else 0,
        "avg_ttft_ms": round(stats["avg_ttft_ms"], 2) if stats.get("avg_ttft_ms") else None,
        "tests_by_model": by_model,
        "recent_tests": recent,
    }


# ── Provider CRUD ──────────────────────────────────────────────


def _dedupe_models(models: list[str]) -> list[str]:
    """按顺序去重，保留首个出现。"""
    seen: set[str] = set()
    out: list[str] = []
    for m in models:
        if m not in seen:
            seen.add(m)
            out.append(m)
    return out


def _enrich_provider(row: dict) -> dict:
    d = dict(row)
    try:
        d["models"] = _dedupe_models(json.loads(d.get("models_json", "[]")))
    except (json.JSONDecodeError, TypeError):
        d["models"] = []
    d["protocol"] = d.get("protocol") or "openai"
    return d


async def list_providers() -> list[dict]:
    rows = _fetchall("SELECT * FROM providers ORDER BY created_at ASC")
    return [_enrich_provider(r) for r in rows]


async def get_provider(provider_id: str) -> dict | None:
    row = _fetchone("SELECT * FROM providers WHERE id = ?", (provider_id,))
    return _enrich_provider(row) if row else None


async def save_provider_models(provider_id: str, models: list[str]) -> dict | None:
    existing = await get_provider(provider_id)
    if not existing:
        return None
    now = datetime.now(timezone.utc).isoformat()
    models = _dedupe_models(models)
    _run(
        "UPDATE providers SET models_json=?, updated_at=? WHERE id=?",
        (json.dumps(models), now, provider_id),
    )
    return {**existing, "models": models, "updated_at": now}


async def create_provider(name: str, base_url: str, api_key: str, models: list[str] | None = None, protocol: str = "openai") -> dict:
    pid = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    models = _dedupe_models(models or [])
    models_str = json.dumps(models)
    _run(
        "INSERT INTO providers (id, name, base_url, api_key, protocol, models_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (pid, name, base_url, api_key, protocol, models_str, now, now),
    )
    return {"id": pid, "name": name, "base_url": base_url, "api_key": api_key, "protocol": protocol, "models": models, "created_at": now, "updated_at": now}


async def update_provider(provider_id: str, name: str, base_url: str, api_key: str, models: list[str] | None = None, protocol: str | None = None) -> dict | None:
    existing = await get_provider(provider_id)
    if not existing:
        return None
    now = datetime.now(timezone.utc).isoformat()
    if models is not None:
        models = _dedupe_models(models)
    models_str = json.dumps(models) if models is not None else existing.get("models_json", "[]")
    protocol = protocol or existing.get("protocol") or "openai"
    _run(
        "UPDATE providers SET name=?, base_url=?, api_key=?, protocol=?, models_json=?, updated_at=? WHERE id=?",
        (name, base_url, api_key, protocol, models_str, now, provider_id),
    )
    return {**existing, "name": name, "base_url": base_url, "api_key": api_key, "protocol": protocol, "models": json.loads(models_str), "updated_at": now}


async def delete_provider(provider_id: str) -> bool:
    existing = await get_provider(provider_id)
    if not existing:
        return False
    _run("DELETE FROM providers WHERE id = ?", (provider_id,))
    return True


# ── Schedule CRUD ──────────────────────────────────────────────


def _enrich_schedule(row: dict) -> dict:
    d = dict(row)
    try:
        d["targets"] = json.loads(d.get("targets_json", "[]"))
    except (json.JSONDecodeError, TypeError):
        d["targets"] = []
    return d


async def list_schedules() -> list[dict]:
    rows = _fetchall("SELECT * FROM schedules ORDER BY created_at ASC")
    return [_enrich_schedule(r) for r in rows]


async def get_schedule(schedule_id: str) -> dict | None:
    row = _fetchone("SELECT * FROM schedules WHERE id = ?", (schedule_id,))
    return _enrich_schedule(row) if row else None


async def create_schedule(
    name: str,
    interval_minutes: int,
    targets: list[dict],
    prompt: str,
    max_tokens: int | None,
    temperature: float | None,
    stream: bool,
    concurrency: int,
    iterations: int,
    max_rpm: int = -1,
) -> dict:
    sid = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    _run(
        """INSERT INTO schedules
           (id, name, enabled, interval_minutes, prompt, max_tokens, temperature,
            stream, concurrency, iterations, max_rpm, targets_json,
            created_at, updated_at, next_run_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            sid, name, 1, interval_minutes, prompt, max_tokens, temperature,
            1 if stream else 0, concurrency, iterations, max_rpm,
            json.dumps(targets), now, now,
            _next_run_iso(now, interval_minutes),
        ),
    )
    return await get_schedule(sid)


async def update_schedule(schedule_id: str, fields: dict) -> dict | None:
    existing = await get_schedule(schedule_id)
    if not existing:
        return None
    now = datetime.now(timezone.utc).isoformat()
    m = {
        "name": fields.get("name", existing["name"]),
        "interval_minutes": fields.get("interval_minutes", existing["interval_minutes"]),
        "targets_json": json.dumps(fields["targets"]) if "targets" in fields else existing["targets_json"],
        "prompt": fields.get("prompt", existing["prompt"]),
        "max_tokens": fields.get("max_tokens", existing["max_tokens"]),
        "temperature": fields.get("temperature", existing["temperature"]),
        "stream": int(bool(fields.get("stream", existing["stream"]))),
        "concurrency": fields.get("concurrency", existing["concurrency"]),
        "iterations": fields.get("iterations", existing["iterations"]),
        "max_rpm": fields.get("max_rpm", existing["max_rpm"]),
        "enabled": int(bool(fields.get("enabled", existing["enabled"]))),
    }
    # 编辑后重置下次执行时间，从此刻开始计时
    m["next_run_at"] = _next_run_iso(now, m["interval_minutes"])
    m["updated_at"] = now
    _run(
        """UPDATE schedules SET
           name=?, interval_minutes=?, targets_json=?, prompt=?, max_tokens=?,
           temperature=?, stream=?, concurrency=?, iterations=?, max_rpm=?,
           enabled=?, next_run_at=?, updated_at=?
           WHERE id=?""",
        (
            m["name"], m["interval_minutes"], m["targets_json"], m["prompt"],
            m["max_tokens"], m["temperature"], m["stream"], m["concurrency"],
            m["iterations"], m["max_rpm"], m["enabled"],
            m["next_run_at"], m["updated_at"],
            schedule_id,
        ),
    )
    return await get_schedule(schedule_id)


async def delete_schedule(schedule_id: str) -> bool:
    existing = await get_schedule(schedule_id)
    if not existing:
        return False
    _run("DELETE FROM schedules WHERE id = ?", (schedule_id,))
    return True


async def set_schedule_enabled(schedule_id: str, enabled: bool) -> dict | None:
    existing = await get_schedule(schedule_id)
    if not existing:
        return None
    now = datetime.now(timezone.utc).isoformat()
    if enabled:
        # 暂停恢复：从此刻重新开始计时
        next_run = _next_run_iso(now, existing["interval_minutes"])
    else:
        next_run = None
    _run(
        "UPDATE schedules SET enabled=?, next_run_at=?, updated_at=? WHERE id=?",
        (int(enabled), next_run, now, schedule_id),
    )
    return await get_schedule(schedule_id)


async def get_due_schedules() -> list[dict]:
    """查询到期且启用的任务（executor 轮询用）。"""
    now = datetime.now(timezone.utc).isoformat()
    return _fetchall(
        "SELECT * FROM schedules WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= ?",
        (now,),
    )


async def update_schedule_run_status(schedule_id: str, status: str) -> None:
    """status: success / partial / failed / running"""
    now = datetime.now(timezone.utc).isoformat()
    _run(
        "UPDATE schedules SET last_run_status=?, last_run_at=? WHERE id=?",
        (status, now, schedule_id),
    )


async def reset_schedule_run_progress(schedule_id: str, total: int) -> None:
    """新一轮执行开始时重置计数。total 为展开迭代后的总测试数。"""
    _run(
        "UPDATE schedules SET run_total=?, run_done=0, run_success=0 WHERE id=?",
        (total, schedule_id),
    )


async def update_schedule_progress(schedule_id: str, success: bool) -> None:
    """单次测试完成时递增：run_done+1，成功样本再 run_success+1。"""
    _run(
        "UPDATE schedules SET run_done = run_done + 1, run_success = run_success + ? WHERE id=?",
        (1 if success else 0, schedule_id),
    )


async def mark_schedule_stale_running() -> None:
    """启动时把遗留的 running 状态重置（进程被杀时执行未收尾）。"""
    _run("UPDATE schedules SET last_run_status='failed' WHERE last_run_status='running'")


async def advance_schedule_next_run(schedule_id: str, interval_minutes: int) -> None:
    """执行完成后推进下次执行时间（仅对 enabled 任务；暂停中不推进）。"""
    now = datetime.now(timezone.utc).isoformat()
    _run(
        "UPDATE schedules SET next_run_at=?, updated_at=? WHERE id=? AND enabled=1",
        (_next_run_iso(now, interval_minutes), now, schedule_id),
    )


def _next_run_iso(now_iso: str, interval_minutes: int) -> str:
    from datetime import timedelta

    dt = datetime.fromisoformat(now_iso)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return (dt + timedelta(minutes=interval_minutes)).astimezone(timezone.utc).isoformat()

