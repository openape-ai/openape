# openape-troop container image.
#
# Multi-stage build following the Nest/Nuxt pattern:
# - Stage 1: Build the monorepo with pnpm + turbo, emit troop's .output
# - Stage 2: Runtime with minimal node image, .output/server only
#
# Build from the monorepo root:
#   docker build -f apps/openape-troop/Dockerfile -t openape-troop:dev .
#
# Run (compose handles this in the real path):
#   docker run --rm -p 3010:3010 --env-file .env.troop openape-troop:dev

# ---- Stage 1: build -------------------------------------------------------
FROM node:22-bookworm-slim AS build

ENV CI=1
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /work

# Copy monorepo manifests
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json ./

# Copy troop app and its workspace deps
COPY apps/openape-troop ./apps/openape-troop
COPY packages ./packages
COPY modules ./modules

# Install deps (skip postinstall to avoid nuxt prepare issues in slim image)
RUN pnpm install --frozen-lockfile --ignore-scripts

# Prepare modules (explicitly run prepare for modules)
RUN pnpm --filter "./modules/*" run prepare

# Build troop and its workspace deps via turbo
RUN pnpm turbo run build --filter="@openape/troop"

# ---- Stage 2: runtime -----------------------------------------------------
FROM node:22-bookworm-slim AS runtime

# Install ca-certificates for outbound https calls + libsql native binding
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy the Nitro .output from build stage
COPY --from=build /work/apps/openape-troop/.output ./.output

# Install libsql native binding (Nitro bundles JS but not native)
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
