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

# Build apes (the CLI nest invokes for privileged steps) + nest itself.
# The --filter ... build invocation only builds the explicitly named
# packages (and their workspace deps), so we don't drag the Nuxt apps
# into the build at all.
RUN pnpm --filter '@openape/apes' build && pnpm --filter '@openape/nest' build

# `pnpm deploy` materializes a self-contained subtree (workspace deps
# flattened, no symlinks into the monorepo's .pnpm store) so the runtime
# image gets a normal node_modules/ that resolves bare imports like
# `import { ofetch } from 'ofetch'`. Without this step the tsup'd dist
# can't find its external deps (tsup bundles only the entry's own code).
RUN pnpm --filter '@openape/apes' deploy --legacy --prod /tmp/deploy/apes \
 && pnpm --filter '@openape/nest' deploy --legacy --prod /tmp/deploy/nest

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
        sudo \
        tini \
    && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
    && chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends gh \
    && rm -rf /var/lib/apt/lists/*

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

# Symlink the binaries onto PATH so the nest's subprocess calls
# (`apes run --as ...`, `openape-nest`) resolve without further plumbing.
RUN ln -sf /opt/openape/apes/dist/cli.js /usr/local/bin/apes \
    && chmod +x /opt/openape/apes/dist/cli.js \
    && ln -sf /opt/openape/nest/dist/index.mjs /usr/local/bin/openape-nest \
    && chmod +x /opt/openape/nest/dist/index.mjs

# The nest binary is set as the entrypoint via tini so SIGTERM
# propagates cleanly to the node process AND any agent subprocesses
# it has spawned.
EXPOSE 9091
WORKDIR $NEST_DATA_DIR
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/openape-nest"]
