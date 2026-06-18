# openape-troop container image.
#
# Multi-stage build for the Nuxt 4 / Nitro troop app.
# Stage 1 builds the monorepo with pnpm and emits the troop's .output/.
# Stage 2 is the runtime: minimal node:22-bookworm-slim with the .output/server.
#
# Build from the monorepo root:
#   docker build -f apps/openape-troop/Dockerfile -t openape-troop:dev .
#
# Run (local smoke test):
#   docker run --rm -p 3010:3010 --env-file .env.troop openape-troop:dev

# ---- Stage 1: build -------------------------------------------------------
FROM node:22-bookworm-slim AS build

ENV CI=1

# pnpm 9.x — pinned via corepack
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /work

# Copy monorepo manifests
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json ./

# Copy troop and its workspace deps (apes, auth, nuxt-auth-sp, core)
COPY apps/openape-troop ./apps/openape-troop
COPY apps/openape-ape-agent ./apps/openape-ape-agent
COPY packages ./packages

# Install deps — ignore postinstall scripts (nuxt prepare runs in build)
RUN pnpm install --frozen-lockfile --ignore-scripts

# Build troop and its workspace deps via turbo
# turbo's build task depends on ^build, so deps are built first
RUN pnpm turbo run build --filter='@openape/troop'

# ---- Stage 2: runtime -----------------------------------------------------
FROM node:22-bookworm-slim AS runtime

# Install ca-certificates for HTTPS (DDISA, Turso, GHCR)
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV NITRO_PORT=3010
ENV PORT=3010
ENV HOST=0.0.0.0

WORKDIR /app

# Copy the built .output from stage 1
COPY --from=build /work/apps/openape-troop/.output ./

EXPOSE 3010

CMD ["node", ".output/server/index.mjs"]
