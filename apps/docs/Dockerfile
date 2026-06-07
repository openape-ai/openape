# syntax=docker/dockerfile:1
# Builds the OpenApe docs (Nuxt) app from the monorepo and serves the Nitro node output.
# Build context MUST be the monorepo root (needs pnpm-lock.yaml + workspace manifests).
FROM node:22-slim AS build
RUN corepack enable \
 && apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NUXT_TELEMETRY_DISABLED=1
COPY . .
RUN pnpm install --filter docs --frozen-lockfile
RUN pnpm --filter docs run build

FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0 NUXT_TELEMETRY_DISABLED=1
COPY --from=build /app/apps/docs/.output ./.output
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
