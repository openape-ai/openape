# openape-llm — the OpenApe pod's LLM proxy container.
#
# Now backed by @openape/codex-proxy (packages/codex-proxy) instead of LiteLLM.
# codex-proxy is a thin OpenAI-compatible proxy over the ChatGPT (Codex)
# Responses backend: it serves `GET /v1/models` + `POST /v1/chat/completions`
# (non-stream JSON by default, SSE on stream:true) against a ChatGPT
# subscription credential. The switch is what lets this container serve
# `gpt-5.5` — the old LiteLLM fork's chatgpt provider could only do gpt-5.4.
#
# In the pod it binds 0.0.0.0:4000 under the network alias `openape-llm`, so
# in-pod agents keep resolving `http://openape-llm:4000/v1` unchanged — same
# auth-free loopback semantics as before (the proxy ignores the Authorization
# header and authenticates to OpenAI with the mounted ChatGPT credential).
#
# Credential: NOT baked in. Mount a *flat* codex auth.json
# ({access_token, refresh_token, id_token, expires_at, account_id}) at
# CODEX_CREDENTIAL_PATH. The proxy refreshes the token and writes it back, so
# mount the directory read-write. (The Codex CLI's ~/.codex/auth.json is the
# *nested* format — transform it first; do not mount it directly or the
# write-back will clobber it.)
#
# codex-proxy has zero runtime npm dependencies and tsup bundles it to a
# self-contained ESM file, so the build context is just the package itself
# (no monorepo/turbo needed) and the runtime stage is node + the bundle.
#
# Build (context = the codex-proxy package):
#   docker build -f apps/openape-llm/Dockerfile -t openape-llm:codex packages/codex-proxy
#
# Run standalone:
#   docker run --rm --init -p 127.0.0.1:4000:4000 \
#     -v "$HOME/.config/openape/codex:/var/lib/openape/codex" \
#     openape-llm:codex

# ---- Stage 1: build the proxy bundle --------------------------------------
FROM node:22-bookworm-slim AS build
WORKDIR /build

# Install the build toolchain (tsup + typescript) from devDependencies only —
# the package declares no runtime dependencies.
COPY package.json tsconfig.json tsup.config.ts ./
RUN npm install --no-audit --no-fund

COPY src ./src
RUN npm run build

# ---- Stage 2: runtime -----------------------------------------------------
FROM node:22-bookworm-slim AS runtime
WORKDIR /app

# Just the bundle — no node_modules, the proxy uses only Node builtins + fetch.
COPY --from=build /build/dist ./dist

ENV CODEX_PROXY_HOST=0.0.0.0
ENV CODEX_PROXY_PORT=4000
ENV CODEX_CREDENTIAL_PATH=/var/lib/openape/codex/auth.json
ENV CODEX_ORIGINATOR=codex_cli_rs

EXPOSE 4000

# /health answers immediately (before any credential use) — see src/bin.ts.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:4000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/bin.js"]
