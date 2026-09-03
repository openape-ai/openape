# The public sandbox image for openape-gated agents: an OpenClaw sandbox that
# already carries the apes CLIs, so a gated agent can identify itself and pull
# its own work without anything being installed at turn time.
#
# Deliberately generic. Anything account- or company-specific (mail CLIs,
# private tooling) belongs in a thin local `FROM` layer, not in the image
# everyone pulls.
FROM node:22-bookworm-slim

ARG APES_VERSION=latest
ARG APE_TASKS_VERSION=latest
ARG APE_PLANS_VERSION=latest

# OpenClaw mounts the agent identity at /home/sandbox/.config/apes and runs
# tools as a non-root user. The name and home path are part of that contract.
RUN useradd --create-home --shell /bin/bash sandbox

RUN npm install -g --no-fund --no-audit \
      "@openape/apes@${APES_VERSION}" \
      "@openape/ape-tasks@${APE_TASKS_VERSION}" \
      "@openape/ape-plans@${APE_PLANS_VERSION}" \
    && npm cache clean --force

USER sandbox
WORKDIR /home/sandbox

# `apes` resolves its identity from $HOME. Stating it here means a caller that
# overrides the container user still gets a predictable config location.
ENV HOME=/home/sandbox

CMD ["/bin/bash"]
