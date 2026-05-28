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
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json tsconfig.json ./
COPY apps ./apps
COPY packages ./packages
COPY examples ./examples

RUN pnpm install --frozen-lockfile

# Build apes (the CLI nest invokes for privileged steps) + nest itself.
RUN pnpm --filter '@openape/apes' build && pnpm --filter '@openape/nest' build

# ---- Stage 2: runtime -----------------------------------------------------
FROM node:22-bookworm-slim AS runtime

# sudo is the privileged-execution boundary on Linux. Install ca-certificates
# so node can reach https endpoints (DDISA + troop). procps gives the nest
# `ps` for its supervisor introspection. tini reaps zombies cleanly when the
# nest spawns agent subprocesses.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        procps \
        sudo \
        tini \
    && rm -rf /var/lib/apt/lists/*

# Nest data dir — bind-mounted by compose so registry + auth survive
# container restarts. The launchd plist's HOME=NEST_DATA_DIR semantics
# stay identical here.
ENV NEST_DATA_DIR=/var/lib/openape/nest
ENV OPENAPE_NEST_PORT=9091
RUN mkdir -p "$NEST_DATA_DIR" \
    && mkdir -p /var/lib/openape/homes

# Copy the built dists and the runtime deps from stage 1.
WORKDIR /opt/openape
COPY --from=build /work/packages/apes/dist        ./apes/dist
COPY --from=build /work/packages/apes/package.json ./apes/package.json
COPY --from=build /work/apps/openape-nest/dist      ./nest/dist
COPY --from=build /work/apps/openape-nest/package.json ./nest/package.json

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
