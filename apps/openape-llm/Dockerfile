# openape-llm — the LiteLLM proxy container.
#
# Purpose: replace the bare-host LiteLLM install (homebrew + brew services
# on macOS, manual systemd on Linux) with a containerised, hatchable
# instance. Inside the OpenApe pod (compose / k8s / cloud VM) it binds
# 127.0.0.1:4000 on the pod network so all in-pod agents resolve to a
# loopback URL — same auth-free semantics as the macOS local path.
#
# Configure via /etc/litellm/config.yaml (mounted from the host or built
# into a custom image inheriting from this one). LITELLM_MASTER_KEY is
# read from env; when unset, the proxy still serves on loopback but with
# `master_key` from the yaml.
#
# Build from monorepo root:
#   docker build -f apps/openape-llm/Dockerfile -t openape-llm:dev .
#
# Run standalone:
#   docker run --rm -p 4000:4000 \
#     -v $PWD/apps/openape-llm/config.example.yaml:/etc/litellm/config.yaml:ro \
#     -e LITELLM_MASTER_KEY=sk-litellm-loopback \
#     openape-llm:dev

FROM python:3.12-slim AS runtime

# tini for clean signal forwarding to the litellm worker.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        tini \
    && rm -rf /var/lib/apt/lists/*

# Pin litellm to a known-good release line. Bump deliberately — LiteLLM
# moves fast and minor versions occasionally break provider auth flows.
RUN pip install --no-cache-dir 'litellm[proxy]==1.55.3'

ENV LITELLM_HOST=0.0.0.0
ENV LITELLM_PORT=4000
ENV LITELLM_CONFIG=/etc/litellm/config.yaml

EXPOSE 4000

# Healthcheck — LiteLLM exposes /health/liveliness (their spelling).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD wget --quiet --spider http://127.0.0.1:4000/health/liveliness || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["sh", "-c", "litellm --config \"$LITELLM_CONFIG\" --host \"$LITELLM_HOST\" --port \"$LITELLM_PORT\""]
