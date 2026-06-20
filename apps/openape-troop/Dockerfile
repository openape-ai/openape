# openape-troop container image.
#
# Multi-stage build following the Nuxt.Dockerfile pattern:
# - Stage 1: Build the monorepo with pnpm + turbo, emit .output
# - Stage 2: Runtime with minimal node image + .output/server
#
# Build from the monorepo root:
#   docker build -f apps/openape-troop/Dockerfile \
#     --build-arg PORT=3010 \
#     -t openape-troop:local .
#
# Or with buildx for multi-arch:
#   docker buildx build --platform linux/arm64,linux/amd64 \
#     -f apps/openape-troop/Dockerfile \
#     --build-arg PORT=3010 \
#     -t registry.openape.ai/openape-troop:<tag> --push .

# ---- Stage 1: build -------------------------------------------------------
FROM node:22-bookworm-slim AS build

ENV CI=1
RUN corepack enable

WORKDIR /work

# Copy monorepo manifests
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json ./

# Copy troop app and its deps
COPY apps/openape-troop ./apps/openape-troop
COPY packages ./packages
COPY modules ./modules

# Install deps (ignore-scripts to skip nuxt prepare postinstall)
RUN pnpm install --frozen-lockfile --ignore-scripts

# Prepare modules (build stubs)
RUN pnpm --filter "./modules/*" run prepare

# Build troop (turbo handles deps via dependsOn ^build)
RUN pnpm turbo run build --filter=@openape/troop

# ---- Stage 2: runtime -----------------------------------------------------
FROM node:22-bookworm-slim AS runtime

ARG PORT=3010

# Install ca-certificates for outbound https calls
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy the built .output from stage 1
COPY --from=build /work/apps/openape-troop/.output ./.output

# Install libsql native binding (Nitro bundles JS wrapper but not native)
RUN cd .output/server \
 && LIBSQL_VER=$(node -p "require('./node_modules/libsql/package.json').version") \
 && PKGARCH=$(node -p "process.arch === 'arm64' ? 'arm64' : 'x64'") \
 && npm pack "@libsql/linux-${PKGARCH}-gnu@${LIBSQL_VER}" \
 && mkdir -p "node_modules/@libsql/linux-${PKGARCH}-gnu" \
 && tar -xzf "libsql-linux-${PKGARCH}-gnu-${LIBSQL_VER}.tgz" -C "node_modules/@libsql/linux-${PKGARCH}-gnu" --strip-components=1 \
 && rm -f "libsql-linux-${PKGARCH}-gnu-${LIBSQL_VER}.tgz"

ENV NITRO_PORT=${PORT}
ENV HOST=0.0.0.0
ENV PORT=${PORT}

EXPOSE ${PORT}

CMD ["node", ".output/server/index.mjs"]
