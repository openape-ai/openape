# openape-troop container image.
#
# Multi-stage build following the Nest pattern:
# - Stage 1 (build): Builds the monorepo with pnpm + turbo, emits troop's .output
# - Stage 2 (runtime): Minimal Node runtime with the prebuilt .output
#
# Build from the monorepo root:
#   docker buildx build -f apps/openape-troop/Dockerfile -t openape-troop:dev .
#
# Run (via compose on chatty):
#   docker compose -f compose/chatty.yml up openape-troop

# ---- Stage 1: build -------------------------------------------------------
FROM node:22-bookworm-slim AS build

ENV CI=1
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /work

# Copy monorepo manifests for dependency installation
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json ./

# Copy troop app and its dependencies
# troop depends on packages that are in the workspace
COPY apps/openape-troop ./apps/openape-troop
COPY packages ./packages

# Install dependencies — ignore-scripts to avoid Nuxt postinstall issues
# that require full Nuxt module resolution
RUN pnpm install --frozen-lockfile --ignore-scripts

# Build troop via turbo — this builds troop and all its workspace deps
RUN pnpm turbo run build --filter='@openape/troop'

# ---- Stage 2: runtime -----------------------------------------------------
FROM node:22-bookworm-slim AS runtime

# Install libsql runtime dependency for Turso
# Nitro bundles the JS wrapper but not the platform-specific native binding
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy the built .output from stage 1
COPY --from=build /work/apps/openape-troop/.output ./

# Install libsql native binding at runtime (arch-matched)
RUN cd .output/server \
    && LIBSQL_VER=$(node -p "require('./node_modules/libsql/package.json').version") \
    && LIBSQL_PKGARCH=$(node -p "process.arch === 'arm64' ? 'arm64' : 'x64'") \
    && npm pack "@libsql/linux-${LIBSQL_PKGARCH}-gnu@${LIBSQL_VER}" \
    && mkdir -p "node_modules/@libsql/linux-${LIBSQL_PKGARCH}-gnu" \
    && tar -xzf "libsql-linux-${LIBSQL_PKGARCH}-gnu-${LIBSQL_VER}.tgz" -C "node_modules/@libsql/linux-${LIBSQL_PKGARCH}-gnu" --strip-components=1 \
    && rm -f "libsql-linux-${LIBSQL_PKGARCH}-gnu-${LIBSQL_VER}.tgz"

# Environment variables for Nitro
ENV NITRO_PORT=3010
ENV HOST=0.0.0.0
ENV PORT=3010

EXPOSE 3010

CMD ["node", ".output/server/index.mjs"]
