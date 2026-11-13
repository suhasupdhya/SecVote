# SecVote API and worker (same image; the worker runs `secvote-worker`).
# Build from the repository root:  docker build -f apps/api/Dockerfile -t secvote-api .
FROM python:3.13-slim

COPY --from=ghcr.io/astral-sh/uv:0.13.7 /uv /usr/local/bin/uv
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy PYTHONUNBUFFERED=1

WORKDIR /app/apps/api
# Dependencies first, so code changes don't reinstall them.
COPY apps/api/pyproject.toml apps/api/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY apps/api/src ./src
RUN uv sync --frozen --no-dev

# Contract ABIs (the deployment addresses file is mounted at run time: packages/shared/deployments.json).
COPY packages/shared/abi /app/packages/shared/abi

# Unprivileged user; uploaded ID cards live in /app/apps/api/var (mount a persistent volume there).
RUN useradd --system --uid 10001 secvote && mkdir -p var/uploads && chown -R secvote var
USER secvote

ENV SECVOTE_ENV=prod SECVOTE_API_HOST=0.0.0.0 SECVOTE_API_PORT=8000
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/healthz').status==200 else 1)"
CMD ["uv", "run", "--no-sync", "secvote-api"]
