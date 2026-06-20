# openape-troop container image.
#
# Multi-stage build following the Nest pattern:
# - Stage 1 (builder): builds the monorepo with pnpm + turbo, emits troop's .output
# - Stage 2 (runtime): minimal Debian-slim + node, runs the Nitro server
#
# Build from the monorepo root:
#   docker build -f apps/openape-troop/Dockerfile -t openape-troop:dev .
#
# Run (compose handles this in prod):
#   docker run --rm -p 3010:3010 --env-file .env.troop openape-troop:dev

# ---- Stage 1: build -------------------------------------------------------
FROM node:22-bookworm-slim AS build

# pnpm 9.x — pinned via corepack so we don't drift from the monorepo's
# packageManager declaration.
ENV CI=1
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /work

# Copy just enough to install deps cached.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json ./
# Only the apps we actually build live in this image.
COPY apps/openape-troop ./apps/openape-troop
COPY packages ./packages

# --ignore-scripts: skip postinstall hooks that might fail in slim image.
# troop's build (nuxt build) doesn't need them.
RUN pnpm install --frozen-lockfile --ignore-scripts

# Build troop and its workspace deps.
# turbo's build task handles dependency ordering.
RUN pnpm turbo run build --filter='@openape/troop'

# ---- Stage 2: runtime -----------------------------------------------------
FROM node:22-bookworm-slim AS runtime

# ca-certificates so node can reach https endpoints (Turso, IdP, etc.)
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy the built .output from stage 1.
# Nitro's .output is self-contained with all JS deps; only libsql needs
# the platform-specific native binding at runtime.
COPY --from=build /work/apps/openape-troop/.output ./

# Install libsql's platform-specific native binding.
# The .output/server/node_modules has the JS wrapper but not the native binary.
RUN cd .output/server \
 && LIBSQL_VER=$(node -p "require('./node_modules/libsql/package.json').version") \
 && PKGARCH=$(node -p "process.arch === 'arm64' ? 'arm64' : 'x64'") \
 && npm pack "@libsql/linux-${PKGARCH}-gnu@${LIBSQL_VER}" \
 && mkdir -p "node_modules/@libsql/linux-${PKGARCH}-gnu" \
 && tar -xzf "libsql-linux-${PKGARCH}-gnu-${LIBSQL_VER}.tgz" -C "node_modules/@libsql/linux-${PKGARCH}-gnu" --strip-components=1 \
 && rm -f "libsql-linux-${PKGARCH}-gnu-${LIBSQL_VER}.tgz"

ENV NITRO_PORT=3010
ENV HOST=0.0.0.0
ENV PORT=3010
EXPOSE 3010

CMD ["node", ".output/server/index.mjs"]
