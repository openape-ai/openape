# Parameterized multi-stage build for a monorepo Nuxt app (idp / troop / chat).
#
# Build from the MONOREPO ROOT, e.g.:
#   docker build -f compose/Nuxt.Dockerfile \
#     --build-arg APP_FILTER=@openape/troop \
#     --build-arg APP_DIR=openape-troop \
#     --build-arg PORT=3010 \
#     -t openape-troop:local .
#
# The build stage runs the full pnpm install (so --frozen-lockfile sees the whole
# workspace) and turbo build (which builds the app's @openape/* deps first), then
# the runtime stage ships only the app's self-contained Nitro .output. Build and
# runtime share the same node:22 base, so native deps (libsql) compile for the
# right arch.

# ---- Stage 1: build -------------------------------------------------------
FROM node:22-bookworm-slim AS build
ARG APP_FILTER
ENV CI=1
RUN corepack enable
WORKDIR /work
COPY . .
# --ignore-scripts: skip the Nuxt apps' `nuxt prepare` postinstall (it needs the
# full module graph and fails under a slim image); `turbo run build` re-prepares
# each app via `nuxi build` and builds its workspace deps first (dependsOn ^build).
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts
# The modules' postinstall `prepare` (skipped by --ignore-scripts) builds each
# module's stub and runs `nuxi prepare playground`, generating the
# playground/.nuxt/tsconfig.json that the module's build tsconfig extends. Run it
# explicitly. The apps' own `nuxt prepare` postinstall (flaky under a slim image)
# stays skipped — `nuxi build` re-prepares each app during the turbo build below.
RUN pnpm --filter "./modules/*" run prepare
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm turbo run build --filter "${APP_FILTER}"

# ---- Stage 2: runtime -----------------------------------------------------
FROM node:22-bookworm-slim AS runtime
ARG APP_DIR
ARG PORT=3000
# ca-certificates so the app's outbound https calls (SP → IdP discovery /
# token validation) can be augmented with the local Caddy CA via
# NODE_EXTRA_CA_CERTS at runtime.
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /work/apps/${APP_DIR}/.output ./.output
# Nitro bundles libsql's JS wrapper but not its platform-specific native binding
# (loaded via a runtime require Nitro can't statically trace). Install the
# matching @libsql/linux-<arch>-gnu so the file DB works — arch-detected, so this
# is correct on both arm64 (Apple Silicon) and x64 hosts. Mirrors the
# scripts/deploy-*.sh "pin native binding" step.
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
