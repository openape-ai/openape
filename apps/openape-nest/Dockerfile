# openape-nest container image.
#
# Stage 1 builds the monorepo with pnpm + turbo and emits the nest's
# `dist/`. Stage 2 is the runtime: minimal Debian-slim + node + sudo +
# the apes & nest binaries. The nest runs as PID 1 (root inside the
# container — the container IS the OpenApe sandbox; no further
# isolation is needed beyond the kernel namespaces Docker already
# gives us).
#
# Build from the monorepo root:
#   docker build -f apps/openape-nest/Dockerfile -t openape-nest:dev .
#
# Run (compose handles this in the real path):
#   docker run --rm -p 9091:9091 -v openape-nest-data:/var/lib/openape/nest openape-nest:dev

# ---- Stage 1: build -------------------------------------------------------
FROM node:22-bookworm-slim AS build

# pnpm 9.x — pinned via corepack so we don't drift from the monorepo's
# packageManager declaration.
ENV CI=1
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /work

# Copy just enough to install deps cached.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json ./
# Only the apps we actually build live in this image. Skipping
# openape-agent-proxy / openape-troop / openape-free-idp / idp / etc.
# avoids dragging Nuxt apps and packages they reference that aren't part
# of the workspace (e.g. @openape/nuxt-auth-sp lives in a sibling repo).
COPY apps/openape-nest ./apps/openape-nest
COPY apps/openape-ape-agent ./apps/openape-ape-agent
COPY packages ./packages

# --ignore-scripts: the Nuxt apps in the monorepo (troop, idp, agent-proxy)
# run `nuxt prepare` postinstall, which spins up the full Nuxt module
# resolution and fails inside a slim node image. We don't build those
# apps in this image — just apes + nest — so skipping their postinstalls
# is safe and cuts install time roughly in half.
RUN pnpm install --frozen-lockfile --ignore-scripts

# Build the nest, the binaries it shells out to (apes, ape-agent), and the
# in-nest codex-proxy. Drive it through turbo, NOT a hand-rolled
# `pnpm --filter X build` chain: turbo's build task is `dependsOn: ["^build"]`,
# so every @openape/* workspace dep (shapes, agent-runtime, core, grants,
# proxy, server, cli-auth, …) is built FIRST, in topological order. The old
# per-package chain didn't build deps first and broke the tsup dts step with
# TS2307 the moment a target gained a new workspace dep (apes → shapes /
# agent-runtime). Only the filtered targets + their deps build — no Nuxt apps.
RUN pnpm turbo run build \
      --filter='@openape/apes' \
      --filter='@openape/nest' \
      --filter='@openape/ape-agent' \
      --filter='@openape/codex-proxy'

# `pnpm deploy` materializes a self-contained subtree (workspace deps
# flattened, no symlinks into the monorepo's .pnpm store) so the runtime
# image gets a normal node_modules/ that resolves bare imports like
# `import { ofetch } from 'ofetch'`. Without this step the tsup'd dist
# can't find its external deps (tsup bundles only the entry's own code).
RUN pnpm --filter '@openape/apes' deploy --legacy --prod /tmp/deploy/apes \
 && pnpm --filter '@openape/nest' deploy --legacy --prod /tmp/deploy/nest \
 && pnpm --filter '@openape/ape-agent' deploy --legacy --prod /tmp/deploy/ape-agent \
 && pnpm --filter '@openape/codex-proxy' deploy --legacy --prod /tmp/deploy/codex-proxy

# ---- Stage 2: runtime -----------------------------------------------------
FROM node:22-bookworm-slim AS runtime

# sudo is the privileged-execution boundary on Linux. Install ca-certificates
# so node can reach https endpoints (DDISA + troop). procps gives the nest
# `ps` for its supervisor introspection. tini reaps zombies cleanly when the
# nest spawns agent subprocesses.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        git \
        gnupg \
        procps \
        python3 \
        sudo \
        tini \
    && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
    && chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends gh \
    && rm -rf /var/lib/apt/lists/*

# Sudoers config — let the nest (running as root, PID 1) sudo to any of
# its supervised agents without a password. The container is the OpenApe
# sandbox; the human operator never logs in here, so unrestricted
# in-container privilege drop is the point.
# `env_keep += NODE_EXTRA_CA_CERTS` so `sudo -u <agent> apes agents sync`
# inherits the local-CA trust path (sudo strips env by default). The bridge
# gets it via its pm2 ecosystem env instead; this covers the direct-sudo path.
RUN printf '%s\n' \
      'Defaults env_keep += "NODE_EXTRA_CA_CERTS"' \
      'root ALL=(ALL) NOPASSWD: ALL' > /etc/sudoers.d/openape-nest \
    && chmod 0440 /etc/sudoers.d/openape-nest

# Nest data dir — bind-mounted by compose so registry + auth survive
# container restarts. The launchd plist's HOME=NEST_DATA_DIR semantics
# stay identical here.
ENV NEST_DATA_DIR=/var/lib/openape/nest
ENV OPENAPE_NEST_PORT=9091
RUN mkdir -p "$NEST_DATA_DIR" \
    && mkdir -p /var/lib/openape/homes

# Copy the deployed subtrees from stage 1 — they include node_modules
# with all production deps flattened (no workspace symlinks).
WORKDIR /opt/openape
COPY --from=build /tmp/deploy/apes ./apes
COPY --from=build /tmp/deploy/nest ./nest
COPY --from=build /tmp/deploy/ape-agent ./ape-agent
COPY --from=build /tmp/deploy/codex-proxy ./codex-proxy

# pm2 is the per-agent process supervisor the nest uses — install
# globally so `pm2 start ...` (invoked by lib/pm2-supervisor.ts) resolves
# the same way the host setup does.
RUN npm install -g pm2

# ape-tasks: the persona agents' `tasks.list` tool shells out to the
# `ape-tasks` CLI, and their operating protocol uses it to read/update
# tasks.openape.ai. Without it on PATH the agents report "ape-tasks: command
# not found" and can't see their assigned work. Installed globally so every
# agent user resolves it.
RUN npm install -g @openape/ape-tasks

# ape-troop: openclaw (and bridge) agents read their company/org via the
# `ape-troop` CLI as a tool. Installed globally so every agent user resolves it.
RUN npm install -g @openape/ape-troop

# openclaw: the foreign one-shot runtime the nest exec's for agents spawned with
# `--type openclaw` (lib/openclaw-adapter.ts runs `openclaw agent --local`).
# Pinned to the version the adapter's config schema was verified against.
RUN npm install -g openclaw@2026.6.8

# Symlink the binaries onto PATH so the nest's subprocess calls
# (`apes run --as ...`, `openape-nest`, `ape-agent`) resolve without
# further plumbing.
RUN ln -sf /opt/openape/apes/dist/cli.js /usr/local/bin/apes \
    && chmod +x /opt/openape/apes/dist/cli.js \
    && ln -sf /opt/openape/nest/dist/index.mjs /usr/local/bin/openape-nest \
    && chmod +x /opt/openape/nest/dist/index.mjs \
    && ln -sf /opt/openape/ape-agent/dist/bridge.mjs /usr/local/bin/ape-agent \
    && chmod +x /opt/openape/ape-agent/dist/bridge.mjs

# Entrypoint runs `docker-entrypoint.sh` before exec'ing the nest. The
# script ensures /var/log/openape exists + recreates the per-agent
# users from the volume-persisted registry (so `docker compose down/up`
# doesn't strand bridges by leaving their /etc/passwd entries gone).
COPY apps/openape-nest/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# tini reaps zombies + propagates SIGTERM cleanly to the nest AND any
# agent subprocesses it has spawned via pm2.
EXPOSE 9091
WORKDIR $NEST_DATA_DIR
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/docker-entrypoint.sh"]
CMD ["/usr/local/bin/openape-nest"]
