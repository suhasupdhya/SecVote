"""Worker process: `uv run secvote-worker` (same codebase and image as the API)."""

from __future__ import annotations

import asyncio
import logging
import time

from secvote.chain import get_chain
from secvote.core.config import check_production, get_settings
from secvote.db import close_db, init_db
from secvote.workers import scheduler
from secvote.workers.indexer import Indexer
from secvote.workers.outbox import Outbox

log = logging.getLogger("secvote.worker")


async def run() -> None:
    settings = get_settings()
    check_production(settings)
    await init_db(settings)
    chain = get_chain(settings)
    await chain.check()  # stop if the chain is gone; never redeploy
    outbox, indexer = Outbox(chain), Indexer(chain)
    log.info("worker started; relayer=%s rpc=%s", chain.relayer.address, settings.rpc_url)
    await scheduler.detect_orphans(chain)
    last_purge = 0.0
    try:
        while True:
            try:
                await scheduler.update_clock(chain)
                await scheduler.batch_members(settings)
                await scheduler.auto_freeze()
                await outbox.tick()
                await indexer.tick()
                await scheduler.tally_sealed(chain)
                if time.monotonic() - last_purge > 3600:
                    await scheduler.purge_documents(settings)
                    last_purge = time.monotonic()
            except Exception:
                log.exception("worker tick failed")
            await asyncio.sleep(settings.worker_poll_seconds)
    finally:
        await close_db()


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    asyncio.run(run())


if __name__ == "__main__":
    main()
