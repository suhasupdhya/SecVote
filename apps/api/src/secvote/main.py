"""App factory only: routers, middleware, lifespan."""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from secvote.api.v1 import admin, auth, ballots, public, trustee, voter
from secvote.chain import get_chain
from secvote.core.config import Settings, check_production, get_settings
from secvote.core.errors import AppError
from secvote.db import close_db, init_db
from secvote.services import officials
from secvote.services.auth import AuthService

log = logging.getLogger("secvote")


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    check_production(settings)  # refuse unsafe settings on a public server

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        await init_db(settings)
        await officials.ensure_owner()
        await AuthService.backfill_email_keys()
        if settings.chain_required:
            await get_chain(settings).check()  # refuse to start on a missing chain; never redeploy
        yield
        await close_db()

    # The interactive API docs are a development aid; production doesn't publish them.
    dev_docs = settings.env != "prod"
    app = FastAPI(
        title="SecVote API",
        version="2.0.0",
        lifespan=lifespan,
        docs_url="/api/docs" if dev_docs else None,
        redoc_url=None,
        openapi_url="/api/openapi.json" if dev_docs else None,
    )

    @app.exception_handler(AppError)
    async def app_error(_: Request, exc: AppError) -> JSONResponse:
        return JSONResponse(
            {"error": {"code": exc.code, "message": exc.message}}, status_code=exc.status_code
        )

    @app.exception_handler(RequestValidationError)
    async def validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        first = exc.errors()[0] if exc.errors() else {}
        field = ".".join(str(x) for x in first.get("loc", [])[1:])
        msg = f"{field}: {first.get('msg', 'invalid input')}" if field else "Invalid input"
        return JSONResponse({"error": {"code": "validation", "message": msg}}, status_code=422)

    @app.middleware("http")
    async def headers_and_log(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Cache-Control"] = response.headers.get("Cache-Control", "no-store")
        if settings.cookie_secure:
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        # Structured, personal-data-free log line: no IP, no user, no body.
        log.info("%s %s %s", request.method, request.url.path, response.status_code)
        return response

    prefix = "/api/v1"
    for r in (auth.router, public.router, voter.router, ballots.router, admin.router, trustee.router):
        app.include_router(r, prefix=prefix)

    @app.get("/healthz")
    async def healthz() -> dict[str, Any]:
        return {"ok": True}

    @app.get("/readyz")
    async def readyz() -> JSONResponse:
        checks: dict[str, Any] = {}
        try:
            from secvote.db.models import User

            await User.find_one()
            checks["mongo"] = "ok"
        except Exception as exc:
            checks["mongo"] = f"error: {type(exc).__name__}"
        if settings.chain_required:
            try:
                await get_chain(settings).check()
                checks["chain"] = "ok"
            except AppError as exc:
                checks["chain"] = f"error: {exc.message}"
            if settings.relayer_min_balance_wei and checks["chain"] == "ok":
                wei = await get_chain(settings).relayer_balance()
                low = wei < settings.relayer_min_balance_wei
                checks["relayer_balance"] = f"low: {wei / 1e18:.4f} left, top it up" if low else "ok"
        ok = all(v == "ok" for v in checks.values())
        return JSONResponse({"ok": ok, "checks": checks}, status_code=200 if ok else 503)

    return app


def run() -> None:
    import uvicorn

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    # access_log=False: uvicorn's access log records client IPs, which we must not keep for /ballots.
    settings = get_settings()
    host, port = settings.api_host, settings.api_port
    if settings.reload:  # dev only: restart on code changes
        from secvote.core.config import API_ROOT

        uvicorn.run(
            "secvote.main:create_app",
            factory=True,
            reload=True,
            reload_dirs=[str(API_ROOT / "src")],
            host=host,
            port=port,
            access_log=False,
            proxy_headers=False,
        )
    else:
        uvicorn.run(create_app(settings), host=host, port=port, access_log=False, proxy_headers=False)


if __name__ == "__main__":
    run()
