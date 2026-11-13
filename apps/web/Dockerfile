# SecVote web app (Next.js), production build.
# Build from the repository root:
#   docker build -f apps/web/Dockerfile -t secvote-web \
#     --build-arg NEXT_PUBLIC_RPC_URL=https://... --build-arg NEXT_PUBLIC_CHAIN_ID=84532 .
FROM node:22-slim AS build
RUN corepack enable
WORKDIR /app

# Public settings are baked in at build time (Next.js inlines NEXT_PUBLIC_*; rewrites are fixed at build).
ARG NEXT_PUBLIC_RPC_URL
ARG NEXT_PUBLIC_CHAIN_ID
ARG SECVOTE_API_URL=http://api:8000
# Proving files for rolls up to 2^depth voters (16 -> 65,536; 20 -> ~1 million). Served by the site itself.
ARG SNARK_MAX_DEPTH=16
# Shown on the privacy notice (/privacy): who runs the site and where to send data questions.
ARG NEXT_PUBLIC_INSTITUTION_NAME=""
ARG NEXT_PUBLIC_PRIVACY_CONTACT=""
ENV NEXT_PUBLIC_RPC_URL=$NEXT_PUBLIC_RPC_URL \
    NEXT_PUBLIC_CHAIN_ID=$NEXT_PUBLIC_CHAIN_ID \
    NEXT_PUBLIC_INSTITUTION_NAME=$NEXT_PUBLIC_INSTITUTION_NAME \
    NEXT_PUBLIC_PRIVACY_CONTACT=$NEXT_PUBLIC_PRIVACY_CONTACT \
    SECVOTE_API_URL=$SECVOTE_API_URL \
    NEXT_PUBLIC_SNARK_ARTIFACTS_URL=/snark-artifacts \
    NEXT_TELEMETRY_DISABLED=1

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/contracts/package.json packages/contracts/
COPY packages/verifier/package.json packages/verifier/
RUN pnpm install --frozen-lockfile --filter "web..."

COPY packages/shared packages/shared
COPY apps/web apps/web
COPY scripts/fetch-snark-artifacts.mjs scripts/
RUN node scripts/fetch-snark-artifacts.mjs --max-depth "$SNARK_MAX_DEPTH"
RUN pnpm --filter web build

FROM node:22-slim
RUN corepack enable && useradd --system --uid 10001 secvote
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
COPY --from=build --chown=secvote /app /app
USER secvote
EXPOSE 3000
CMD ["pnpm", "--filter", "web", "start", "--port", "3000"]
