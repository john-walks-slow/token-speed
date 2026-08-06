import sqlite3
import threading
import os
import uuid
import json
from datetime import datetime, timezone

DB_PATH = os.path.join(os.path.dirname(__file__), "speed_tests.db")

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
            tpm             REAL,
            success         INTEGER,
            error_message   TEXT,
            created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )""")
        _local.conn.execute("""CREATE TABLE IF NOT EXISTS providers (
            id          TEXT PRIMARY KEY,
            name        TEXT NOT NULL,
            base_url    TEXT NOT NULL,
            api_key     TEXT DEFAULT '',
            models_json TEXT DEFAULT '[]',
            created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )""")
        # Migrations for schema additions
        for col_def in [
            "actual_model TEXT DEFAULT ''",
            "content_ttft_ms REAL",
            "reasoning_tokens INTEGER DEFAULT 0",
            "content_tokens INTEGER DEFAULT 0",
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
        _local.conn.commit()
    return _local.conn


def _run(sql, params=None):
    conn = _get_conn()
    cur = conn.execute(sql, params or ())
    conn.commit()
    return cur


def _fetchall(sql, params=None):
    cur = _run(sql, params)
    return [dict(r) for r in cur.fetchall()]


def _fetchone(sql, params=None):
    cur = _run(sql, params)
    row = cur.fetchone()
    return dict(row) if row else None


async def insert_speed_test(result: dict) -> None:
    _run(
        """INSERT INTO speed_tests
           (id, base_url, model, actual_model, prompt, max_tokens, temperature,
            ttft_ms, content_ttft_ms, total_latency_ms, tokens_generated,
            reasoning_tokens, content_tokens, tps, tpm,
            success, error_message, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
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
            result["tps"],
            result["tpm"],
            1 if result["success"] else 0,
            result.get("error_message"),
            result.get("created_at"),
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
            "avg_tpm": 0,
            "avg_latency_ms": 0,
            "avg_ttft_ms": None,
            "tests_by_model": [],
            "recent_tests": [],
        }

    stats = _fetchone(
        """SELECT
            CAST(SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) AS REAL) / COUNT(*) as success_rate,
            AVG(tps) as avg_tps,
            AVG(tpm) as avg_tpm,
            AVG(total_latency_ms) as avg_latency_ms,
            AVG(CASE WHEN ttft_ms IS NOT NULL THEN ttft_ms ELSE NULL END) as avg_ttft_ms
        FROM speed_tests"""
    )

    by_model = _fetchall(
        """SELECT model, COUNT(*) as count, AVG(tps) as avg_tps, AVG(total_latency_ms) as avg_latency
        FROM speed_tests WHERE success = 1
        GROUP BY model ORDER BY count DESC"""
    )

    recent = _fetchall("SELECT * FROM speed_tests ORDER BY created_at DESC LIMIT 10")

    return {
        "total_tests": total,
        "success_rate": round(stats["success_rate"] * 100, 1) if stats["success_rate"] else 0,
        "avg_tps": round(stats["avg_tps"], 2) if stats["avg_tps"] else 0,
        "avg_tpm": round(stats["avg_tpm"], 2) if stats["avg_tpm"] else 0,
        "avg_latency_ms": round(stats["avg_latency_ms"], 2) if stats["avg_latency_ms"] else 0,
        "avg_ttft_ms": round(stats["avg_ttft_ms"], 2) if stats.get("avg_ttft_ms") else None,
        "tests_by_model": by_model,
        "recent_tests": recent,
    }


# ── Provider CRUD ──────────────────────────────────────────────


def _enrich_provider(row: dict) -> dict:
    d = dict(row)
    try:
        d["models"] = json.loads(d.get("models_json", "[]"))
    except (json.JSONDecodeError, TypeError):
        d["models"] = []
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
    _run(
        "UPDATE providers SET models_json=?, updated_at=? WHERE id=?",
        (json.dumps(models), now, provider_id),
    )
    return {**existing, "models": models, "updated_at": now}


async def create_provider(name: str, base_url: str, api_key: str, models: list[str] | None = None) -> dict:
    pid = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    models_str = json.dumps(models or [])
    _run(
        "INSERT INTO providers (id, name, base_url, api_key, models_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (pid, name, base_url, api_key, models_str, now, now),
    )
    return {"id": pid, "name": name, "base_url": base_url, "api_key": api_key, "models": models or [], "created_at": now, "updated_at": now}


async def update_provider(provider_id: str, name: str, base_url: str, api_key: str, models: list[str] | None = None) -> dict | None:
    existing = await get_provider(provider_id)
    if not existing:
        return None
    now = datetime.now(timezone.utc).isoformat()
    models_str = json.dumps(models) if models is not None else existing.get("models_json", "[]")
    _run(
        "UPDATE providers SET name=?, base_url=?, api_key=?, models_json=?, updated_at=? WHERE id=?",
        (name, base_url, api_key, models_str, now, provider_id),
    )
    return {**existing, "name": name, "base_url": base_url, "api_key": api_key, "models": json.loads(models_str), "updated_at": now}


async def delete_provider(provider_id: str) -> bool:
    existing = await get_provider(provider_id)
    if not existing:
        return False
    _run("DELETE FROM providers WHERE id = ?", (provider_id,))
    return True

