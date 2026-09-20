import asyncio
import logging

from .database import (
    advance_schedule_next_run,
    get_due_schedules,
    get_provider,
    get_schedule,
    insert_speed_test,
    mark_schedule_stale_running,
    reset_schedule_run_progress,
    update_schedule_progress,
    update_schedule_run_status,
)
from .speed_test import execute_batch_tests
from .network_settings import client_kwargs as net_client_kwargs

logger = logging.getLogger(__name__)

POLL_INTERVAL_SECONDS = 30


class SpeedTestScheduler:
    """在 FastAPI 事件循环内跑的定时测速调度器。

    30s 轮询到期任务，每个任务派发独立 asyncio task，_running_ids 防重入。
    """

    def __init__(self):
        self._poll_task: asyncio.Task | None = None
        self._tasks: set[asyncio.Task] = set()
        self._running_ids: set[str] = set()

    @property
    def running_ids(self) -> set[str]:
        return self._running_ids

    def is_running(self, schedule_id: str) -> bool:
        return schedule_id in self._running_ids

    async def start(self) -> None:
        await mark_schedule_stale_running()
        self._poll_task = asyncio.create_task(self._poll())
        logger.info("speed-test scheduler started")

    async def stop(self) -> None:
        if self._poll_task:
            self._poll_task.cancel()
            try:
                await self._poll_task
            except asyncio.CancelledError:
                pass
            self._poll_task = None
        # 等待运行中的任务收尾
        if self._tasks:
            await asyncio.gather(*list(self._tasks), return_exceptions=True)
            self._tasks.clear()
        self._running_ids.clear()
        logger.info("speed-test scheduler stopped")

    def spawn_run(self, schedule_id: str, advance_next: bool = True) -> None:
        """派发一次执行。advance_next=False 用于手动触发（不推进 next_run_at）。

        调用方需先通过 is_running() 防重入。
        """
        self._running_ids.add(schedule_id)
        task = asyncio.create_task(self._run_schedule(schedule_id, advance_next=advance_next))
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    async def _poll(self) -> None:
        while True:
            try:
                await self._check_due()
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("scheduler poll error")
            await asyncio.sleep(POLL_INTERVAL_SECONDS)

    async def _check_due(self) -> None:
        due = await get_due_schedules()
        for s in due:
            if s["id"] in self._running_ids:
                continue
            self.spawn_run(s["id"], advance_next=True)

    async def _run_schedule(self, schedule_id: str, advance_next: bool) -> None:
        interval_minutes = None
        try:
            sched = await get_schedule(schedule_id)
            if not sched:
                return
            if advance_next:
                interval_minutes = sched["interval_minutes"]

            await update_schedule_run_status(schedule_id, "running")

            # 解析 targets → 按 provider 实时取最新连接信息
            tests = []
            for t in sched["targets"]:
                prov = await get_provider(t["provider_id"])
                if not prov:
                    continue  # provider 已删除，跳过该 target
                for m in t["models"]:
                    tests.append({
                        "model": m,
                        "base_url": prov["base_url"],
                        "api_key": prov["api_key"],
                        "provider_id": prov["id"],
                        "provider_name": prov["name"],
                        "protocol": prov.get("protocol", "openai"),
                    })

            if not tests:
                # 全部 target 失效
                await update_schedule_run_status(schedule_id, "failed")
                return

            # 重置本轮计数，单测完成后逐条递增，供前端 chip 展示 x/y
            await reset_schedule_run_progress(
                schedule_id, len(tests) * (sched["iterations"] or 1)
            )

            async def on_progress(result: dict) -> None:
                await update_schedule_progress(
                    schedule_id, bool(result.get("success"))
                )

            async def sqlite_sink(result: dict) -> None:
                await insert_speed_test(result, schedule_id)

            results = await execute_batch_tests(
                tests,
                prompt=sched["prompt"] or "",
                max_tokens=sched["max_tokens"],
                temperature=sched["temperature"],
                stream=bool(sched["stream"]),
                concurrency=sched["concurrency"] or 1,
                iterations=sched["iterations"] or 1,
                schedule_id=schedule_id,
                max_rpm=sched["max_rpm"] if sched["max_rpm"] is not None else -1,
                on_progress=on_progress,
                sink=sqlite_sink,
                client_kwargs=net_client_kwargs(),
            )
            ok = sum(1 for r in results if r["success"])
            if ok == len(results):
                status = "success"
            elif ok > 0:
                status = "partial"
            else:
                status = "failed"
            await update_schedule_run_status(schedule_id, status)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("schedule %s run failed", schedule_id)
            await update_schedule_run_status(schedule_id, "failed")
        finally:
            if interval_minutes:
                await advance_schedule_next_run(schedule_id, interval_minutes)
            self._running_ids.discard(schedule_id)
