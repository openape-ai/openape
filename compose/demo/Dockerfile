# Playwright runner for the local-stack story/guide flows. Joins the
# openape-test network so the browser reaches https://*.openape.test exactly
# like the app containers do (same DNS, same Caddy CA). Build from the
# monorepo root. The story scripts themselves are bind-mounted at /demo/src
# (live-iterable, no image rebuild); runners invoke e.g.
#   node /demo/src/run-stories.mjs
FROM node:22-bookworm-slim
WORKDIR /demo
COPY compose/demo/package.json ./
# Install playwright + the chromium browser and its OS deps.
RUN npm install && npx playwright install --with-deps chromium
