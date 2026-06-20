# openape-troop container image (multi-arch: arm64 + amd64).
#
# Stage 1: Builder — builds the monorepo and emits troop's .output
# Stage 2: Runtime — minimal node:22-bookworm-slim with the .output
#
# Build from the monorepo root:
#   docker buildx build --platform linux/arm64,linux/amd64 \
#     -f apps/openape-troop/Dockerfile -t ghcr.io/openape-ai/openape-troop:<sha> --push .
#
# Local smoke test:
#   docker compose -f compose/chatty.yml up openape-troop

# ---- Stage 1: build -------------------------------------------------------
FROM node:22-bookworm-slim AS build

ENV CI=1
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /work

# Copy monorepo manifests
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json ./

# Copy troop app and its dependencies
COPY apps/openape-troop ./apps/openape-troop
COPY packages ./packages

# Install deps (skip postinstall scripts that fail in slim images)
RUN pnpm install --frozen-lockfile --ignore-scripts

# Build troop (turbo handles deps via dependsOn: ["^build"])
RUN pnpm turbo run build --filter='@openape/troop'

# ---- Stage 2: runtime -----------------------------------------------------
FROM node:22-bookworm-slim AS runtime

# Install libsql native binding (required at runtime for Turso)
# The binding is platform-specific; we install it in the final image
# to ensure the correct arch is present.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy the built .output from the builder
COPY --from=build /work/apps/openape-troop/.output ./

# Install the platform-specific libsql binding
# libsql is bundled by Nitro but the native binary is not included
RUN cd .output/server \
    && LIBSQL_VER=$(node -p "require('./node_modules/libsql/package.json').version") \
    && LIBSQL_PKGARCH=$(node -p "process.arch === 'arm64' ? 'arm64' : 'x64'") \
    && npm pack "@libsql/linux-${LIBSQL_PKGARCH}-gnu@${LIBSQL_VER}" \
    && mkdir -p "node_modules/@libsql/linux-${LIBSQL_PKGARCH}-gnu" \
    && tar -xzf "libsql-linux-${LIBSQL_PKGARCH}-gnu-${LIBSQL_VER}.tgz" \
        -C "node_modules/@libsql/linux-${LIBSQL_PKGARCH}-gnu" \
        --strip-components=1 \
    && rm -f "libsql-linux-${LIBSQL_PKGARCH}-gnu-${LIBSQL_VER}.tgz"

# Environment vars for Nitro
ENV NITRO_PORT=3010
ENV PORT=3010
ENV HOST=0.0.0.0

EXPOSE 3010

CMD ["node", ".output/server/index.mjs"]
