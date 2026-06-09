# Playwright runner for the local-stack screenshot flows. Joins the openape-test
# network so the browser reaches https://*.openape.test exactly like the app
# containers do (same DNS, same Caddy CA). Build from the monorepo root.
FROM node:22-bookworm-slim
WORKDIR /demo
COPY compose/demo/package.json ./
# Install playwright + the chromium browser and its OS deps.
RUN npm install && npx playwright install --with-deps chromium
COPY compose/demo/screenshot.mjs ./
ENTRYPOINT ["node", "screenshot.mjs"]
